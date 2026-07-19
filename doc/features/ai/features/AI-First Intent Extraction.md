# AI-First Intent Extraction (NLU)

## Summary

The Slack Timesheet Agent uses **AI-first structured intent extraction** when `AI_INTENT_EXTRACTION_ENABLED=true`. Natural Thai/English is understood by the model; **deterministic code** validates, resolves masters, selects Business Tools, and enforces confirmation.

Architecture:

```text
User text
  → (optional) load Intent Draft (scoped Redis key)
  → AI structured intent (JSON schema)
  → deterministic enforce (dates, hours, Project/Task, tool mapping, merge rules)
  → Business Tool / clarification
  → (writes) prepare → confirm → fenced Redis execution → Sheets
```

Regex Decision Engine remains the **flag-off** path and **technical fallback** when extraction fails.

## Feature flag

| Env | Effect |
|-----|--------|
| `AI_INTENT_EXTRACTION_ENABLED=true` | AI extraction first |
| unset / false | Existing `decideBusinessTool` regex engine only |

## Structured intent (proposal only)

Validated with Zod (`StructuredIntentSchema`). Forbidden keys: `employeeId`, `email`, `slackUserId`, `staffId`, `timesheetStaffId`, Zoho IDs.

The model cannot authorize an arbitrary tool. Round-0 `enforceRequiredBusinessTool` still overwrites wrong tool calls.

## Intent Draft ownership and keys

**Policy:** Preserve an incomplete draft until TTL expiry unless the user explicitly cancels/replaces it or a complete tool decision is produced. Unrelated messages must not merge into it.

Redis key (production only — no in-memory production fallback):

```text
timesheet:intent-draft:{encodeURIComponent(conversationId)}:{encodeURIComponent(slackUserId)}
```

- Scoped by **both** conversation and trusted Slack user (from request metadata, never from the model).
- Two users in the same channel have independent drafts.
- Draft TTL: **10 minutes**.
- Distinct from pending write confirmations (`timesheet:pending-change:*`).
- Never stores employeeId / email / Zoho identity.

## Follow-up merge rules

Merge with an existing draft **only** when at least one is true:

1. Extractor returns `refersToPrevious=true`
2. Message deterministically matches a missing field (hours / date / unique Project / unique Task)
3. Explicit continue phrase (e.g. ต่อจากเมื่อกี้)
4. Same write intent with new slot values

**Do not** auto-fill the first missing field from any short message.

`general_conversation` (ขอบคุณ, เล่าเรื่องแมว, What is a timesheet?, …) while a draft exists:

- Return no Business Tool
- Do **not** convert to a Timesheet intent
- Do **not** mutate the draft

Draft intent cannot silently change (create ≠ update). Model `missingFields` are recomputed deterministically.

## Cancel precedence

1. Pending write confirmation exists + bare `ยกเลิก` → `cancel_timesheet_change`
2. No pending confirmation + incomplete Intent Draft + bare `ยกเลิก` → clear draft (“ยกเลิกคำขอแล้ว”)
3. Explicit draft cancel (`ยกเลิกคำขอนี้`, `ไม่ลงเวลาแล้ว`, `cancel this draft`) → clear draft
4. Neither → no pending request

## Redis draft-store failure

Intent Drafts are conversational assistance. Redis failure must not crash the conversation or invent identity errors.

| Situation | Behavior |
|-----------|----------|
| Complete request, draft get fails | Continue extraction/enforce without draft; log `draftStoreAvailable=false` |
| Incomplete request, draft set fails | Controlled clarify: ask for all fields in one message; do not claim a draft was saved |
| Follow-up that needs draft, get fails | Ask user to resend the complete request; do not guess |
| Production | Redis only — never fall back to in-memory |

Typed outcomes: `draft_store_unavailable`, `draft_not_found`, `draft_expired`, `draft_saved`, `draft_cleared`, `draft_found`, `draft_preserved`.

## Clarification vs general conversation

Incomplete but recognizable Timesheet requests **clarify**. They must not fall through to general conversation or invent identity errors unless a real identity path failed.

## Testing note

- `intent-nlu.test.ts` fixture extractors prove **deterministic enforcement**, not live model language quality.
- `intent-draft-safety.test.ts` exercises `extractStructuredIntent` with a **mocked** OpenAI transport (prompt, `responseFormat=json_object`, `temperature=0`, Zod). That does **not** prove the deployed model understands Thai/English.
- End-to-end natural-language quality requires a **live Slack staging** run with `AI_INTENT_EXTRACTION_ENABLED=true` and the configured model.

## Code

- `src/lib/ai/intent/*` — schema, extract, enforce, follow-up, drafts, decide
- `src/lib/ai/conversation.ts` — wires AI-first decide when flag enabled
- `src/lib/timesheet/write/master-resolve.ts` — Project/Task resolution

## Required tests

Draft isolation, topic switching, follow-ups, Redis failure, production extraction boundary, cancel precedence — see `intent-draft-safety.test.ts` and `intent-nlu.test.ts`.

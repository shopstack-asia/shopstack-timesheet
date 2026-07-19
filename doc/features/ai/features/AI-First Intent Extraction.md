# AI-First Intent Extraction (NLU)

## Summary

The Slack Timesheet Agent **always** uses AI-first structured intent extraction for natural-language business routing. No environment variable is required. Natural Thai/English is understood by the model; **deterministic code** validates, resolves masters, selects Business Tools, and enforces confirmation.

Architecture:

```text
User text
  → bare confirm/cancel (deterministic, when applicable)
  → load Intent Draft (scoped Redis key)
  → AI structured intent (JSON schema)
  → deterministic enforce (dates, hours, Project/Task, tool mapping, merge rules)
  → Business Tool / clarification / general conversation
  → (writes) prepare → confirm → fenced Redis execution → Sheets
```

**Regex is not a business-intent fallback.** Regex remains only for narrow deterministic cases (bare `ยืนยัน` / `confirm`, bare `ยกเลิก` / `cancel`, ISO date/range validation helpers, confirmation ownership, Redis safety). Natural-language Timesheet, profile, work-context, read, create, update, delete, and submit intents are never classified by the legacy regex Decision Engine on the production conversation path.

## Migration note (removed flag)

The former opt-in env var `AI_INTENT_EXTRACTION_ENABLED` has been **removed**. AI-first extraction runs automatically at application start. Rollback means **redeploying the previous application version**, not switching natural-language routing back to regex via an environment variable.

## Extraction failure (fail-closed)

When structured extraction fails (timeout, network, rate limit, invalid JSON, empty response, malformed intent, forbidden identity fields, unexpected model output):

- Return a controlled clarification (Thai/English)
- **Zero** Business Tool calls
- **Zero** Sheets writes
- **Zero** pending write confirmations
- Do **not** call `decideBusinessTool`
- Do **not** invent identity/access wording
- Log structured outcomes such as `extraction_failed` / `malformed_intent`

## Structured intent (proposal only)

Validated with Zod (`StructuredIntentSchema`). Forbidden keys: `employeeId`, `email`, `slackUserId`, `staffId`, `timesheetStaffId`, Zoho IDs.

The model cannot authorize an arbitrary tool. Round-0 `enforceRequiredBusinessTool` still overwrites wrong tool calls.

Fixed intent → tool mapping includes prepare_* for writes, read tools, confirm/cancel, `general_conversation` → no tool, unknown business → clarification.

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

If extraction fails technically, do **not** treat the message as general conversation — return the controlled extraction-failure response.

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

## Identity and writes

- Conversation Context remains the only employee identity source.
- Business Tools continue calling `rejectAiIdentityFields`.
- Direct writers are not exposed to OpenAI.
- Write flow: AI intent → enforce → prepare → explicit confirm → Redis fenced execution → `submitDayTimesheetForStaff` with `allowCustomProject:false` → complete-day read-back.
- **Submit Week remains unsupported.**

## Production testing and rollback

There is no staging environment. After deploy, run a controlled production acceptance test with a safe employee account and safe test date (create → cancel → create → confirm → duplicate confirm → multi-step draft → general chat while draft open → restore data).

If testing fails: **revert the deployment**. Do not reintroduce regex business-intent routing via an environment variable. Preserve logs and typed error evidence; fix through the AI-first architecture.

## Testing note

- `intent-nlu.test.ts` fixture extractors prove **deterministic enforcement**, not live model language quality.
- `intent-draft-safety.test.ts` exercises `extractStructuredIntent` with a **mocked** OpenAI transport (prompt, `responseFormat=json_object`, `temperature=0`, Zod).
- End-to-end natural-language quality is verified in **production Slack** after deploy.

## Code

- `src/lib/ai/intent/*` — schema, extract, enforce, follow-up, drafts, decide
- `src/lib/ai/conversation.ts` — always wires `decideWithIntentExtraction`
- `src/lib/timesheet/write/master-resolve.ts` — Project/Task resolution

## Required tests

Unconditional AI-first path, extraction failure (zero tools / no regex fallback), draft isolation, topic switching, follow-ups, Redis failure, production extraction boundary, cancel precedence — see `intent-draft-safety.test.ts` and `intent-nlu.test.ts`.

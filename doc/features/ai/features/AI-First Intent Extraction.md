# AI-First Intent Extraction (NLU)

## Summary

The Slack Timesheet Agent **always** uses AI-first structured intent extraction for natural-language business routing. No environment variable is required. Natural Thai/English is understood by the model; **deterministic code** validates, resolves masters, selects Business Tools, and enforces confirmation.

Architecture:

```text
User text
  → owned pending? → semantic pending-response extraction → deterministic enforce
       (confirm / cancel / correction / unrelated / clarify — no phrase list)
  → else: load Intent Draft (scoped Redis key)
  → AI structured intent (JSON schema)
  → deterministic enforce (dates, hours, Project/Task, tool mapping, merge rules)
  → Business Tool / clarification / general conversation
  → (writes) prepare → confirm → fenced Redis execution → Sheets
```

**Regex is not a business-intent fallback and is not write authorization for pending confirmations.** ISO date/range helpers, Intent Draft explicit-cancel phrases, confirmation ownership, Redis fencing, and Slack button action IDs may remain deterministic. Natural-language Timesheet confirm/cancel/correction uses semantic pending-response extraction. Natural-language Timesheet, profile, work-context, read, create, update, delete, and submit intents are never classified by the legacy regex Decision Engine on the production conversation path.

See also [Semantic Pending-Response Extraction.md](./Semantic%20Pending-Response%20Extraction.md).

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

## Follow-up merge rules (deterministic state machine)

The AI model proposes semantic intent. Deterministic code decides whether a message continues an Intent Draft, which single slot is targeted, and whether to merge, clarify, preserve the Draft, or treat the message as general conversation.

**Target selection** (trusted Draft only — never model `missingFields`):

1. Exactly one primary field in `draft.missingFields` → that field
2. Else `draft.lastClarificationField` if still missing → that field
3. Else no safe target (never silently multi-merge)

Primary fields: `date` | `project` | `task` | `hours`

**Decision order:**

1. Empty message → preserve Draft (`empty_message`)
2. Explicit Draft cancellation → clear Draft (`explicit_cancel`)
3. Known unrelated phrase (conservative safety layer) without continuation → general (`unrelated_general_phrase`)
4. Resolve target from Draft; if none → general / `no_merge_signal` / list missing fields (same write) — never multi-merge
5. Evaluate raw user answer for that target via Bangkok date/hours parsers or **canonical Project/Task masters**
6. Apply model-intent × resolution table (below)

**Continuation signal** = `refersToPrevious` OR explicit continue phrase.

| Model / signal | resolved | ambiguous | not_found | invalid | unavailable |
|----------------|----------|-----------|-----------|---------|-------------|
| Continuation | merge target | hint + candidates | hint + candidates | re-clarify target | dependency |
| `general_conversation` | override merge | override + candidates | **general** (no Draft change, no candidates) | **general** | dependency |
| `unknown` | override merge | hint + candidates | re-clarify target (no generic question) | re-clarify | dependency |
| Same write intent | merge target | hint + candidates | hint + candidates (when clear answer) | re-clarify | dependency |
| Different write | `intent_mismatch` (unless continuation) | — | — | — | — |

Canonical resolution is the evidence that a short Task/Project answer is a valid follow-up. Message length alone is not evidence.

**General + not_found + no continuation = general conversation** (Draft unchanged). Do not expand `UNRELATED_GENERAL_RE` into the primary NLU.

**Explicit continuation + not_found = targeted business clarification** with canonical candidates.

**Target-only mutation:** `applyDraftMerge` copies trusted Draft state and applies only `TargetResolution.targetField`. Non-target slots and resolved IDs stay authoritative. Model multi-field output is ignored. Model `missingFields` are never final.

**Dependency failure:** resolver throw → `master_data_unavailable` / `read_failed`, Draft preserved, no prepare, no identity wording.

If extraction fails technically, do **not** treat the message as general conversation — return the controlled extraction-failure response.

Draft intent cannot silently change (create ≠ update). Model `missingFields` are **never** final — enforcement recomputes them after every merge.

## Canonical create-slot completion (hint ≠ resolved)

`computeCanonicalCreateMissingFields` (alias `recomputeCreateMissingFields`) is the only completion authority for `create_timesheet_entry` Drafts.

| Slot | Completes only when | Does **not** complete |
|------|----------------------|------------------------|
| Date | Valid `resolvedDate` (YYYY-MM-DD) | Bare `dateExpression` |
| Project | Non-empty trusted `resolvedProjectId` from master resolve | `projectHint` alone |
| Task | Non-empty trusted `resolvedTaskId` from master resolve | `taskHint` alone |
| Hours | Finite hours in `(0, 24]` per existing validation | `0`, negative, `NaN`, `Infinity`, missing |

**Hint does not mean resolved.** Hints are diagnostic / clarification state only. The model must never supply `resolvedProjectId` or `resolvedTaskId` — those IDs come only from canonical master resolution (`allowCustomProject` remains false).

**not_found / ambiguous:** preserve the target hint, clear the target resolved ID, keep the target in `missingFields`, set clarification metadata (`lastClarificationField`, reason, `lastResolutionOutcome`), increment `clarificationCount` for that business clarification, show candidates when policy requires — **no prepare**.

**Resolved merge:** set hint + resolved ID for the target only, then recompute `missingFields` from the full working Draft via canonical rules. Non-target slots and resolved IDs are preserved (strict target-only merge).

**Draft load normalization:** `normalizeIntentDraft` runs on Redis/in-memory `get` and on `buildDraftFromSlots`. Legacy Drafts with hint-but-no-ID (or invalid date/hours) and empty `missingFields` are repaired before decision processing. Hints are kept; IDs are never invented.

**Prepare authorization:** before `prepare_create_timesheet_entry`, `assertCanonicalCreateReady` requires valid `resolvedDate`, `resolvedProjectId`, `resolvedTaskId`, valid hours, and empty canonical `missingFields`. Fail closed with targeted clarification if any invariant fails. Do not authorize prepare from hints, model `missingFields`, or model confidence alone.

**Sequential correction examples:**

1. Draft waits for Task → user `ต่อจากเมื่อกี้ ใช้ ZZZ` → Task `not_found`, `taskHint=ZZZ`, `resolvedTaskId` absent, `missingFields` still contains `task` → user `PM` → resolve `T-PM` → prepare once with preserved Project/date/hours.
2. Task `ambiguous` → candidates, Task still missing → unique selection → prepare.
3. Same pattern for Project (`ZZZ` → `RMS` / ambiguous → unique Project).

## Soft slot enrichment

After the model classifies a write intent, deterministic enrichment may fill **null** slots still present in the same message (e.g. `เป็น PM` → `taskHint`, hours, today). This does not classify business intent and does not invent Project/Task IDs.

## Canonical Project / Task resolution

`src/lib/timesheet/write/master-resolve.ts` resolves hints against Sheets masters only:

- exact ID / code / name
- normalized name
- unique abbreviation / initials derived from canonical names (e.g. `PM` → Project Management when unique)
- token/stem match (`Project Manager` → Project Management)
- conservative unique fuzzy match

Never invent IDs. Ambiguous → targeted candidate list. Not found → candidate list after repeated attempts. Failures use typed reasons (`project_not_found`, `task_not_found`, `project_ambiguous`, `task_ambiguous`) — never identity/access wording.

## Targeted clarification and loop prevention

Clarifications name the actual missing/ambiguous field (Project / Task / hours / date). Avoid the generic “ต้องการลงงานอะไรครับ” when the outstanding slot is known.

Draft loop fields: `lastClarificationField`, `lastClarificationReason`, `clarificationCount`, `lastUserAnswerNorm`, `lastResolutionOutcome`.

Rules:

- Never ask the same empty-slot question indefinitely after a new answer is received
- After failed resolution, explain why and list canonical candidates
- One Slack event → at most one user-facing decision path (no recursive conversation)
- Clear draft after successful prepare or explicit draft cancel

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

Unconditional AI-first path, extraction failure (zero tools / no regex fallback), draft isolation, topic switching, follow-ups, Redis failure, production extraction boundary, cancel precedence, **clarification-loop regression**, canonical PM/RMS resolve, **canonical missingFields / sequential not_found→correction / ambiguous→selection / Draft load normalization** — see `intent-draft-safety.test.ts`, `intent-nlu.test.ts`, `intent-clarification-loop.test.ts`, `intent-draft-matrix.test.ts`, `intent-draft-lifecycle.test.ts`.

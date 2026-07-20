# Semantic Pending-Response Extraction

## Overview

When an **owned** `PendingTimesheetChange` exists, the user’s next message is classified by a dedicated semantic extractor before normal Timesheet intent extraction. The model interprets meaning (Thai/English, polite particles, colloquial speech, paraphrases, minor typos). **Application code** authorizes confirm / cancel / correction / clarification. No production phrase dictionary or regex is used as write authorization.

## Architecture

```text
User message
  → resolve Conversation Context
  → load confirmable owned pending (slackUserId + conversationId + employeeId, status=pending, not expired)
  → if none: normal AI-first intent path (unless a prior selected target expired → controlled expiry message)
  → if multiple owned:
       load selected-pending target (navigation state)
       if valid selected → semantic extraction against that proposal only
       else resolve ordinal against displayed-choice snapshot, else visible business fields
       unique selection → persist selected target; selection-only asks confirm/cancel/correct (zero writes)
       selection-plus-action → semantic on same message against selected proposal only
       zero/ambiguous → show numbered safe choices + persist choice snapshot
  → if exactly one target (owned or selected): semantic pending-response extraction
  → Zod strict schema validation
  → deterministic enforcement (confirm, cancel, and correction prepare require confidence ≥ 0.75)
  → confirm | cancel | correction (prepare only after cancel===cancelled) | clarify | unrelated
  → existing fenced Redis write lifecycle
```

## Multi-pending selection (persisted across turns)

Selection is **navigation state**, not write authorization. Confirm/cancel/correction still reload and validate the authoritative `PendingTimesheetChange` (ownership, expiry, status, fencing).

### Selected target (Redis)

```ts
type SelectedPendingTimesheetTarget = {
  schemaVersion: 1;
  conversationId: string;
  slackUserId: string;
  employeeId: string;
  confirmationId: string; // server-owned only
  selectedAt: string;
  expiresAt: string;
  selectionVersion: number;
};
```

- Key: `timesheet:selected-pending:{encodedConversationId}:{encodedSlackUserId}`
- TTL: **10 minutes**, capped so it never outlives the selected pending record
- On every load: verify conversation, Slack user, and Conversation Context `employeeId`
- Invalid/malformed → delete and ignore; Redis unavailable → fail closed
- In-memory Map is a **test double only** — never the production default
- Never accept `confirmationId` / identity / Redis keys / hashes / versions from AI or user input

### Displayed-choice snapshot (ordinal safety)

```ts
type PendingChoiceSnapshot = {
  schemaVersion: 1;
  conversationId: string;
  slackUserId: string;
  employeeId: string;
  choices: Array<{ ordinal: number; confirmationId: string; safeFingerprint: string }>;
  createdAt: string;
  expiresAt: string;
};
```

- Key: `timesheet:pending-choices:{encodedConversationId}:{encodedSlackUserId}`
- Choices are sorted for presentation by safe business fields (date, project, task, hours, operation) — **not** `createdAt` for authorization
- Numeric replies resolve **only** against the stored snapshot that generated the displayed list
- Bare `1` / `2` while a snapshot is active are ordinals, never hours
- If snapshot missing/expired/malformed/stale (fingerprint or confirmationId no longer matches live owned pending) → re-list; never shift ordinals to another proposal
- Duplicate ordinals or confirmationIds invalidate the snapshot
- Do not log snapshot, confirmation IDs, or Redis keys

### Selection-only vs selection-plus-action

| User message | Behavior |
|--------------|----------|
| `1`, `Hertz`, `RMS 3 ชั่วโมง` | Persist selected target; ask confirm/cancel/correct; **zero** Timesheet writes |
| `ยืนยันรายการ Hertz`, `cancel RMS`, `แก้ Hertz เป็น 4 ชั่วโมง` | Resolve target first; semantic extraction against that safe proposal; existing confidence/conflict gates; model never supplies authoritative `confirmationId` |

If selection vs action cannot be distinguished safely → persist selection, ask one clarification, do not guess write authorization.

### Lifecycle — clear selected target when

- Confirmation completes successfully
- Cancellation succeeds
- Correction cancel returns `cancelled` and replacement preparation begins
- Selected pending expires or leaves `pending`
- Ownership validation fails
- Choice snapshot becomes invalid / user must re-choose
- Cross-conversation or employee mismatch

### Preserve selected target when

- Semantic extraction is ambiguous or low confidence
- OpenAI / extractor fails
- User asks an unrelated question (answer normally; confirm/cancel tools suppressed)
- Clarification about confirm/cancel/correction is shown

After correction creates a replacement pending: clear the old selected target. Do **not** auto-select the replacement; it still requires a new confirmation.

## Multiple owned pending proposals

- `loadOwnedPendingChange` returns `owned` (exactly one) or `multiple_owned` (two+).
- **Never** select by `createdAt`, array order, or any implicit heuristic.
- With `multiple_owned` and no valid selected target, application code resolves via:
  1. Ordinal protocol against the **stored** choice snapshot
  2. Otherwise visible business fields (date / project / task / hours)
- Unique match → persist selection (and optionally upgrade to action via semantic classification of the same message).
- Zero or multiple matches → controlled clarification with numbered safe summaries. No confirm/cancel/prepare/writer. No confirmationId, employeeId, Redis keys, hashes, or fencing versions in the message.
- The model must never supply an authoritative pending ID.

## Strict schema

```ts
{
  intent: 'confirm' | 'cancel' | 'correction' | 'unrelated' | 'ambiguous',
  confidence: number, // 0..1
  hasNewMutation: boolean,
  correction: { dateHint?, projectHint?, taskHint?, hours? } | null,
  reasonCode: string
}
```

- `.strict()` — unknown properties rejected
- Forbidden: `employeeId`, `email`, `slackUserId`, `staffId`, `confirmationId`, `executionVersion`, `toolName`, Redis keys, snapshot hashes

## Deterministic enforcement

Shared threshold: `PENDING_ACTION_CONFIDENCE_THRESHOLD = 0.75` (confirm, cancel, and correction prepare).

| Intent | Rules |
|--------|--------|
| `confirm` | `confidence >= 0.75`, `hasNewMutation === false`, `correction === null`. Routes to `confirm_timesheet_change` with server-owned `confirmationId`. |
| `cancel` | Same confidence/conflict gates as confirm. Clear high-confidence cancel only. Never Sheets writer. Low confidence or mutation/correction signals → clarify (preserve pending). |
| `correction` | Never confirms the old proposal. Requires `confidence >= 0.75`. Cancel old pending; **replacement prepare only if cancel returns `status === 'cancelled'`**. Other cancel statuses fail closed with zero prepare. New proposal still needs confirmation. |
| `unrelated` | Preserve pending (and selected target). Normal AI-first path; confirm/cancel tools suppressed. |
| `ambiguous` / low confidence / extractor failure | Fail closed. Zero writes. Preserve pending and selected target. Concise clarification. |

## Confirmation UX

Do **not** tell users to type exact words. Example Thai copy:

> หากข้อมูลถูกต้อง สามารถตอบยืนยันได้ตามธรรมชาติ หรือแจ้งสิ่งที่ต้องการแก้ไขได้เลยครับ

Multi-pending list copy (safe summaries only):

> มีหลายรายการที่รอการยืนยันครับ กรุณาเลือกหมายเลขหรือระบุวันที่ Project งาน หรือจำนวนชั่วโมง

## Audit (non-sensitive)

`pendingResponseOutcome`, `extractorOutcome`, `confidenceBand`, `enforcementOutcome`, `toolOutcome`, `requestId` — never raw identity, snapshots, Redis keys, or message bodies.

## Source Code References

- `src/lib/ai/pending-response/*` (including `selection-store.ts`, `selection-types.ts`, `select-pending.ts`, `route.ts`)
- `src/lib/ai/conversation.ts`
- `src/lib/timesheet/write/prepare.ts` (`NATURAL_CONFIRM_HINT_TH`)

## Required tests

`pending-response.test.ts`, `pending-blockers.test.ts`, and `multi-pending-selection.test.ts`: multi-owned clarification, selection persistence across turns, ordinal snapshot safety, cross-user/conversation isolation, cancel confidence gates, correction cancel-result races, and `runConversation` production paths (tests A–M).

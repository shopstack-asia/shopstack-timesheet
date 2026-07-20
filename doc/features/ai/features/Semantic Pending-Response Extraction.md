# Semantic Pending-Response Extraction

## Overview

When an **owned** `PendingTimesheetChange` exists, the user’s next message is classified by a dedicated semantic extractor before normal Timesheet intent extraction. The model interprets meaning (Thai/English, polite particles, colloquial speech, paraphrases, minor typos). **Application code** authorizes confirm / cancel / correction / clarification. No production phrase dictionary or regex is used as write authorization.

## Architecture

```text
User message
  → resolve Conversation Context
  → load confirmable owned pending (slackUserId + conversationId + employeeId, status=pending, not expired)
  → if none: normal AI-first intent path
  → if multiple owned: resolve by visible business fields OR clarify (never newest-created-at)
  → if exactly one target: semantic pending-response extraction (json_object, temperature 0)
  → Zod strict schema validation
  → deterministic enforcement (confirm AND cancel require confidence ≥ 0.75)
  → confirm | cancel | correction (prepare only after cancel===cancelled) | clarify | unrelated
  → existing fenced Redis write lifecycle
```

## Multiple owned pending proposals

- `loadOwnedPendingChange` returns `owned` (exactly one) or `multiple_owned` (two+).
- **Never** select by `createdAt`, array order, or any implicit heuristic.
- With `multiple_owned`, application code first tries `resolveOwnedPendingSelection` using date / project / task / hours visible in the user reply.
- Unique match → semantic extraction proceeds against that **server-selected** record.
- Zero or multiple matches → controlled clarification listing safe summaries (date, project, task, hours). No confirm/cancel/prepare/writer. No confirmationId, employeeId, Redis keys, hashes, or fencing versions in the message.
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

Shared threshold: `PENDING_ACTION_CONFIDENCE_THRESHOLD = 0.75` (confirm and cancel).

| Intent | Rules |
|--------|--------|
| `confirm` | `confidence >= 0.75`, `hasNewMutation === false`, `correction === null`. Routes to `confirm_timesheet_change` with server-owned `confirmationId`. |
| `cancel` | Same confidence/conflict gates as confirm. Clear high-confidence cancel only. Never Sheets writer. Low confidence or mutation/correction signals → clarify (preserve pending). |
| `correction` | Never confirms the old proposal. Cancel old pending; **replacement prepare only if cancel returns `status === 'cancelled'`**. Other cancel statuses (`already_completed`, `expired`, `unavailable`, `no_pending_change`) fail closed with zero prepare. New proposal still needs confirmation. |
| `unrelated` | Preserve pending. Normal AI-first path; confirm/cancel tools suppressed. |
| `ambiguous` / low confidence / extractor failure | Fail closed. Zero writes. Preserve pending. Concise clarification. |

## Confirmation UX

Do **not** tell users to type exact words. Example Thai copy:

> หากข้อมูลถูกต้อง สามารถตอบยืนยันได้ตามธรรมชาติ หรือแจ้งสิ่งที่ต้องการแก้ไขได้เลยครับ

## Audit (non-sensitive)

`pendingResponseOutcome`, `extractorOutcome`, `confidenceBand`, `enforcementOutcome`, `toolOutcome`, `requestId` — never raw identity, snapshots, Redis keys, or message bodies.

## Source Code References

- `src/lib/ai/pending-response/*`
- `src/lib/ai/conversation.ts`
- `src/lib/timesheet/write/prepare.ts` (`NATURAL_CONFIRM_HINT_TH`)

## Required tests

`pending-response.test.ts` and `pending-blockers.test.ts`: multi-owned clarification, selection by business fields, cancel confidence gates, correction cancel-result races, and `runConversation` production paths.

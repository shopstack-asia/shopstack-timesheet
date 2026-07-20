# Semantic Pending-Response Extraction

## Overview

When an **owned** `PendingTimesheetChange` exists, the user’s next message is classified by a dedicated semantic extractor before normal Timesheet intent extraction. The model interprets meaning (Thai/English, polite particles, colloquial speech, paraphrases, minor typos). **Application code** authorizes confirm / cancel / correction / clarification. No production phrase dictionary or regex is used as write authorization.

## Architecture

```text
User message
  → resolve Conversation Context
  → load owned PendingTimesheetChange (slackUserId + conversationId + employeeId, status=pending)
  → if none: normal AI-first intent path (acknowledgements cannot confirm foreign/old proposals)
  → if owned pending: semantic pending-response extraction (json_object, temperature 0)
  → Zod strict schema validation
  → deterministic enforcement
  → confirm_timesheet_change | cancel_timesheet_change | prepare_* (after cancel) | clarify | unrelated passthrough
  → existing fenced Redis write lifecycle
```

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
- Model never selects tools or supplies writer arguments

## Deterministic enforcement

| Intent | Rules |
|--------|--------|
| `confirm` | Allowed only if `confidence >= 0.75`, `hasNewMutation === false`, `correction === null`. Routes solely to `confirm_timesheet_change` with server-owned `confirmationId`. Existing ownership/TTL/fencing still apply. |
| `cancel` | Cancellation meaning wins. Routes to `cancel_timesheet_change`. Never calls the Sheets writer. |
| `correction` | Never confirms the old proposal. Cancel/supersede old pending, then `prepare_*` with merged hints → **new** confirmation required. Incomplete correction → targeted clarify. |
| `unrelated` | Preserve pending. Answer via normal AI-first path; confirm/cancel tools suppressed for that turn. |
| `ambiguous` / low confidence / extractor failure | Fail closed. Zero writes. Preserve pending. One concise clarification in the user’s language. |

Confirmation is also forbidden when mutation signals conflict, schema validation fails, or ownership cannot be proven.

## Confirmation UX

Do **not** tell users to type exact words. Example Thai copy:

> หากข้อมูลถูกต้อง สามารถตอบยืนยันได้ตามธรรมชาติ หรือแจ้งสิ่งที่ต้องการแก้ไขได้เลยครับ

## Audit (non-sensitive)

`pendingResponseOutcome`, `extractorOutcome`, `confidenceBand`, `enforcementOutcome`, `toolOutcome`, `requestId` — never raw identity, snapshots, Redis keys, or message bodies.

## Source Code References

- `src/lib/ai/pending-response/*`
- `src/lib/ai/conversation.ts` (pending routing before `decideWithIntentExtraction`)
- `src/lib/timesheet/write/prepare.ts` (`NATURAL_CONFIRM_HINT_TH`)

## Required tests

Covered in `src/lib/ai/pending-response/pending-response.test.ts`: semantic variations, unseen paraphrases, cancel/negation, correction, unrelated, ambiguous/low-confidence, extractor failures, ownership, no-pending acknowledgements, and `runConversation` production path with mocked transport.

# Cancel Timesheet Change

## Tool

`cancel_timesheet_change`

## How users reach this tool

Semantic pending-response extraction maps cancellation meaning to this tool only when **deterministic cancel authorization** passes: `intent === 'cancel'`, `confidence >= 0.75`, `hasNewMutation === false`, `correction === null`, and exactly one owned pending target. Low-confidence or conflicting cancel/correction signals clarify and preserve the pending proposal.

Cancellation takes precedence over confirmation **only** for clear, high-confidence cancel — it does not bypass confidence, conflict, or ownership gates. **No phrase allow-list** authorizes the call.

## Input

| Field | Required |
|-------|----------|
| `confirmationId` | optional |

If omitted and exactly one pending exists for the conversation (+ same user/employee), that change is cancelled. Multiple pendings → ask which one.

## Behavior

Marks pending `cancelled`. **No Google Sheets mutation.**

# Cancel Timesheet Change

## Tool

`cancel_timesheet_change`

## How users reach this tool

Semantic pending-response extraction maps cancellation meaning (including negation and polite Thai/English variants) to this tool. Cancellation takes precedence over confirmation. **No phrase allow-list** authorizes the call — only validated semantic intent + ownership checks.

## Input

| Field | Required |
|-------|----------|
| `confirmationId` | optional |

If omitted and exactly one pending exists for the conversation (+ same user/employee), that change is cancelled. Multiple pendings → ask which one.

## Behavior

Marks pending `cancelled`. **No Google Sheets mutation.**

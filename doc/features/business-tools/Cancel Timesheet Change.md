# Cancel Timesheet Change

## Tool

`cancel_timesheet_change`

## Input

| Field | Required |
|-------|----------|
| `confirmationId` | optional |

If omitted and exactly one pending exists for the conversation (+ same user/employee), that change is cancelled. Multiple pendings → ask which one.

## Behavior

Marks pending `cancelled`. **No Google Sheets mutation.**

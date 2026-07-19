# Confirm Timesheet Change

## Tool

`confirm_timesheet_change`

## Input

| Field | Required |
|-------|----------|
| `confirmationId` | yes |

Mutation fields (`date`, `hours`, `projectId`, `proposedSnapshot`, `operation`, …) are **rejected**. Mutation loads only from the pending store.

## Execution

1. Load pending by `confirmationId`
2. Verify same Slack user, conversation, employee
3. Status must be `pending` and not expired
4. Atomic claim → `executing`
5. Re-read Sheets; hash must equal `originalSnapshotHash` else `conflict`
6. `submitDayTimesheetForStaff(..., allowCustomProject: false)` with full proposed day
7. Read-back verify proposed vs persisted (by projectId+taskId+hours)
8. Mark `completed`; cache result for Slack retries

## Result statuses

`completed` | `conflict` | `expired` | `cancelled` | `already_completed` | `failed`

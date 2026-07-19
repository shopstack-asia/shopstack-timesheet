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
3. Status must be `pending` and not expired; a non-stale `executing` claim returns `already_processing`
4. Atomic claim → `executing`; after the 90-second lease, reclaim and reconcile a stale claim
5. Re-read Sheets and build a lossless snapshot. Incomplete data fails closed with no write.
6. If current content already equals proposed, mark completed without writing. Otherwise current must equal original (content equality is accepted only during stale recovery), else `conflict`.
7. `submitDayTimesheetForStaff(..., allowCustomProject: false)` with full proposed day
8. Read-back builds a lossless snapshot and verifies proposed content, then marks `completed` and caches the result for Slack retries.

## Result statuses

`completed` | `conflict` | `expired` | `cancelled` | `already_completed` | `already_processing` | `unavailable` | `failed`

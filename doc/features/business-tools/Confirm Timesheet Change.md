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
3. Status must be claimable: `pending`, or stale `executing` (lease expired). A non-stale `executing` claim returns `already_processing`
4. Atomic claim or stale reclaim → `executing` with a new `executionVersion` fencing token
5. Re-read Sheets and build a lossless snapshot. Incomplete data fails closed with no write (`markFailed` only if fence still held)
6. If current content already equals proposed, `markCompleted(version, …)` without writing. Otherwise current must equal original (content equality accepted during stale recovery), else `markConflict(version)` with zero writes
7. **`assertExecutionOwnership(confirmationId, executionVersion)`** immediately before the writer
8. Only if ownership is current: `submitDayTimesheetForStaff(..., allowCustomProject: false)` with full proposed day
9. Read-back builds a lossless snapshot and verifies proposed content, then `markCompleted(version, …)` and caches the result for Slack retries

All finalize calls inspect Redis CAS results. Fence loss → return the safe result for the **persisted** state (never claim this worker completed).

Design: **idempotent confirmation with snapshot reconciliation and fenced execution leases** — not absolute exactly-once across Redis + Sheets.

## Result statuses

`completed` | `conflict` | `expired` | `cancelled` | `already_completed` | `already_processing` | `unavailable` | `failed`

# Timesheet Write Foundation

## Summary

Confirmation-gated Timesheet mutations for the Slack AI assistant. Prepare tools never write Google Sheets. Confirmation loads mutation state from a server-side pending store and executes through the same canonical day-replace writer as the Weekly Timesheet UI (`submitDayTimesheetForStaff`).

## Flow

1. Understand request (Decision Engine)
2. Resolve date (Asia/Bangkok → `YYYY-MM-DD`)
3. Resolve Project / Task from canonical master data
4. Read current persisted day (canonical reader)
5. Validate business rules
6. Store `PendingTimesheetChange` (TTL 10 minutes)
7. Show confirmation summary (no Sheets write)
8. User confirms → `confirm_timesheet_change({ confirmationId })`
9. Ownership + expiry + snapshot-hash checks
10. Canonical write (full day snapshot)
11. Canonical read-back verify
12. Report success only after verification

## AI-visible tools

| Tool | Sheets write? |
|------|---------------|
| `prepare_create_timesheet_entry` | No |
| `prepare_update_timesheet_entry` | No |
| `prepare_delete_timesheet_entry` | No |
| `prepare_submit_timesheet` | No (returns `unsupported`) |
| `confirm_timesheet_change` | Yes (via canonical writer) |
| `cancel_timesheet_change` | No |

There is **no** unconfirmed direct-write tool in the AI registry. Internal helpers such as `timesheetTools.submit_day_timesheet` remain outside the OpenAI tool list.

## Identity

- Employee identity comes **only** from Conversation Context.
- Prepare/confirm tools reject AI-supplied `employeeId`, `staffId`, `email`, `slackUserId`.
- Confirmation is bound to the same `slackUserId`, `conversationId`, and `employeeId`.

## Day snapshot semantics

`submitDayTimesheetForStaff` replaces the complete employee/date snapshot. Prepare always builds the **full proposed day** (preserving unaffected entries). Confirmation writes that full snapshot — never a single entry alone.

## Pending store

- Abstraction: `PendingTimesheetChangeStore` (`src/lib/timesheet/write/pending-store.ts`)
- Default: **in-memory**, TTL **10 minutes**, one-time atomic claim (`pending` → `executing`)
- **Not horizontally distributed.** Redis (or equivalent) is required before multi-instance deploy.

## Concurrency

Normalized snapshot hash (`hashDaySnapshot`) compared at confirm time. Mismatch → `conflict` (no overwrite).

## Idempotency

- Same `confirmationId` executes at most once (atomic claim + completed result cache for Slack retries).

## Submit Week

UI “Submit Week” sequentially upserts each day via the same day writer. There is **no** separate Sheets `submitted` flag. Canonical read hardcodes `submitted: false`. Therefore `prepare_submit_timesheet` returns `unsupported` and does not invent submit state.

## Code

- `src/lib/timesheet/write/*` — pending types, store, hash, prepare, confirm, cancel, master resolve, audit
- `src/lib/tools/business/timesheet-write/` — AI tool wrappers
- `src/lib/timesheet/timesheet-service.ts` — `submitDayTimesheetForStaff`
- `src/lib/ai/write-decision.ts` + `decision-engine.ts` — write routing

## Related docs

- [Prepare Create Timesheet Entry.md](./Prepare%20Create%20Timesheet%20Entry.md)
- [Prepare Update Timesheet Entry.md](./Prepare%20Update%20Timesheet%20Entry.md)
- [Prepare Delete Timesheet Entry.md](./Prepare%20Delete%20Timesheet%20Entry.md)
- [Prepare Submit Timesheet.md](./Prepare%20Submit%20Timesheet.md)
- [Confirm Timesheet Change.md](./Confirm%20Timesheet%20Change.md)
- [Cancel Timesheet Change.md](./Cancel%20Timesheet%20Change.md)
- [Pending Timesheet Change Lifecycle.md](./Pending%20Timesheet%20Change%20Lifecycle.md)
- [Write Security Boundary.md](./Write%20Security%20Boundary.md)

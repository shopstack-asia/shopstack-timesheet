# Weekly submit and Sheets sync

### Overview

Staff submit the week so Google Sheets Time Log matches submitted entries per day for that staff member.

**Note:** There is no separate Sheets “submitted” status column. Persistence is Time Log upsert/delete only. Slack AI `prepare_submit_timesheet` is therefore **unsupported**; Slack mutations use confirmation-gated prepare/confirm tools that call the same `submitDayTimesheetForStaff` day writer (`allowCustomProject: false`).

### Business Purpose

Persist accurate weekly time against projects/tasks for reporting.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff with `staffProfile` | `POST /api/timesheet/submit` | Sync one day |

### Workflow

1. **Client (Submit Week):**
   - Require at least one entry in the week.
   - Every entry: non-empty `projectId`, `taskId`, `hours > 0`.
   - User clicks **Submit Week once**; the client POSTs each day with `entries.length > 0` **sequentially** (await one day, then the next) via `submitWeekDaysSequentially`.
   - On full success, reload week via get API.
2. **Server:**
   - Zod validate; allow empty `entries` (delete-all semantics).
   - Load cached projects/tasks; require every `taskId` in task map.
   - Acquire Redis **Time Log write lock** (`timesheet:sheets:timelog:write`) before any Sheets mutate.
   - Load existing Sheets rows for staff+date.
   - Delete rows whose `Project ID|Task ID` not in submit set.
   - Create custom projects if needed (see custom-project doc).
   - Upsert remaining rows (Time Log ID = SHA-256 first 16 of `date|staffId|projectId|taskId`).
   - Release lock (token-safe delete). Lock wait timeout / Redis failure → **503**.

### Use Cases

- Add/update entries for one or more days
- Remove an entry from a day that still has other entries (key missing from submit → delete)
- API-only: clear entire day with `entries: []` (**UI does not call this**)

### Business Logic

- Sync key: `` `${projectId}|${taskId}` `` (custom name uses the name as project key until created).
- Empty submit array → delete all existing rows for staff/date.
- Staff identity from `session.staffProfile` (EmployeeID, names, position).
- Concurrent submits across users/instances are serialized by the Redis write lock so `rowNumber`-based deletes/updates do not race.

### Validation Rules

| Layer | Rules |
|-------|--------|
| Client | ≥1 entry in week; each entry project/task non-empty; hours > 0; sends leave/holiday/future/over-24 ack flags when applicable |
| API Zod | date `YYYY-MM-DD`; hours 0–24; projectId/taskId min length 1; optional ack booleans |
| API policy | Server enforces leave (OVERRIDE ack), holiday ack, future ack, day total > 24 ack, hours > 0 for non-empty days; holiday/leave dependency unavailable → 503 (fail closed; never treat miss as empty holidays) |
| API | Invalid task ID → 400; policy reject → 400; unauthorized → 401; rate limit → 429; rate-limit Redis down → 503 (`failOpen: false`); lock/Redis failure → 503; holiday **source** unavailable after cache-aside → 503 (never treat cache miss as empty holidays) |

### Edge Cases

- UI never POSTs empty days → deleting all entries on a day in the UI **does not remove Sheets rows** until that day is submitted with entries or empty payload via API.
- Hours `0` accepted by API but blocked by UI submit validation.
- Mid-week day failure: remaining days are still attempted; UI reports failed dates.

### API and Integration Behavior

**`POST /api/timesheet/submit`**

```json
{
  "date": "2026-07-14",
  "entries": [{ "projectId": "…", "taskId": "…", "hours": 2.5 }]
}
```

- Response: `ApiResponse`
- Upstream: Google Sheets (service account); Redis required for write lock

### Data Model Summary

`TimeLogRow` / Time Log sheet columns:

| Column | Source |
|--------|--------|
| Time Log ID | SHA-256 prefix of `date\|staffId\|projectId\|taskId` |
| Date | Submit `date` |
| Staff ID / First / Last / Position | Session `staffProfile` |
| Project ID / Client / Name / Code | Master project or newly created `*New` project |
| Task ID / Task | Master task |
| Hours | Entry hours |

Sheet structure setup: [master-data/projects-and-tasks-from-sheets.md](../../master-data/features/projects-and-tasks-from-sheets.md).

### Known Limitations

- UI ↔ API gap on clearing days (documented above).
- Week submit is sequential per-day POSTs (not a single week transaction).
- Submit requires Redis; without it the API returns 503 rather than writing unlocked.

### Source Code References

- `src/components/WeeklyTimesheet.tsx` (submit handler)
- `src/lib/submit-week-days.ts` (one-click sequential POSTs)
- `src/app/api/timesheet/submit/route.ts`
- `src/lib/sheets-write-lock.ts` (Redis Time Log write lock)
- `src/lib/google-sheets.ts` (`generateTimeLogId`, upsert/delete helpers)

### Required tests

- `src/lib/sheets-write-lock.test.ts` — acquire/release; wait then acquire; lock timeout; token-safe release; Redis errors
- `src/lib/submit-week-days.test.ts` — sequential order; skip empty days; continue after mid failure
- Zod rejects bad date / hours > 24
- Invalid task → 400
- Empty entries deletes existing rows (mocked Sheets)
- Upsert uses stable Time Log ID hash

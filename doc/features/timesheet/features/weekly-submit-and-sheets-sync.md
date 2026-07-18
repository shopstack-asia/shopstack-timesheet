# Weekly submit and Sheets sync

### Overview

Staff submit the week so Google Sheets Time Log matches submitted entries per day for that staff member.

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
   - For each day with `entries.length > 0`, `POST /api/timesheet/submit` with `{ date, entries }`.
   - On success, reload week via get API.
2. **Server:**
   - Zod validate; allow empty `entries` (delete-all semantics).
   - Load cached projects/tasks; require every `taskId` in task map.
   - Load existing Sheets rows for staff+date.
   - Delete rows whose `Project ID|Task ID` not in submit set.
   - Create custom projects if needed (see custom-project doc).
   - Upsert remaining rows (Time Log ID = SHA-256 first 16 of `date|staffId|projectId|taskId`).

### Use Cases

- Add/update entries for one or more days
- Remove an entry from a day that still has other entries (key missing from submit → delete)
- API-only: clear entire day with `entries: []` (**UI does not call this**)

### Business Logic

- Sync key: `` `${projectId}|${taskId}` `` (custom name uses the name as project key until created).
- Empty submit array → delete all existing rows for staff/date.
- Staff identity from `session.staffProfile` (EmployeeID, names, position).

### Validation Rules

| Layer | Rules |
|-------|--------|
| Client | ≥1 entry in week; each entry project/task non-empty; hours > 0 |
| API Zod | date `YYYY-MM-DD`; hours 0–24; projectId/taskId min length 1 |
| API | Invalid task ID → 400; unauthorized → 401 |

### Edge Cases

- UI never POSTs empty days → deleting all entries on a day in the UI **does not remove Sheets rows** until that day is submitted with entries or empty payload via API.
- Hours `0` accepted by API but blocked by UI submit validation.

### API and Integration Behavior

**`POST /api/timesheet/submit`**

```json
{
  "date": "2026-07-14",
  "entries": [{ "projectId": "…", "taskId": "…", "hours": 2.5 }]
}
```

- Response: `ApiResponse`
- Upstream: Google Sheets (service account)

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
- Sequential submit per day (not a single week transaction).

### Source Code References

- `src/components/WeeklyTimesheet.tsx` (submit handler)
- `src/app/api/timesheet/submit/route.ts`
- `src/lib/google-sheets.ts` (`generateTimeLogId`, upsert/delete helpers)

### Required tests

- Zod rejects bad date / hours > 24
- Invalid task → 400
- Empty entries deletes existing rows (mocked Sheets)
- Upsert uses stable Time Log ID hash
- UI filter only submits days with entries

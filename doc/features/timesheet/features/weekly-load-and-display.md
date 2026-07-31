# Weekly load and display

### Overview

Authenticated staff view a Monday–Sunday week, loading existing Time Log entries plus master data, leave, and holidays for display.

### Business Purpose

Show the current week’s logged time and context needed to edit accurately.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff | `/timesheet` + related APIs | View/edit week |

### Workflow

1. Shell passes `weekStart` (Monday).
2. Parallel client fetches:
   - `GET /api/master/projects` → projects + clients
   - `GET /api/master/tasks`
   - `GET /api/timesheet/get?weekStart=YYYY-MM-DD`
   - `GET /api/staff/leave/monthly?year=&month=` (for months spanned by week)
   - `GET /api/timesheet/holidays?year=` (when location available)
3. Build 7 `DailyTimesheet` days (Mon–Sun); merge loaded entries; compute totals.
4. Render column (7 cards) or tab (day switcher with color cues).

### Screen Behavior

- Loading state until master + timesheet initialized.
- Tab buttons tint for holiday (red), FULL leave (orange), HALF (yellow).
- Week total hours displayed; Submit Week control (see submit doc).

### Business Logic

- Week: `weekStartsOn: 1`; days `i = 0..6` (Monday–Sunday).
- Get API: `getWeeklyTimesheetForStaff` → shared `getTimeLogRowsForStaffRange` (calendar Mon–Sun); filter Sheets rows by `Staff ID` (= Zoho EmployeeID); group by `Date`; dedupe by Time Log ID.
- Time Log reads use `valueRenderOption: 'UNFORMATTED_VALUE'` so column B returns a Sheets date serial (or legacy ISO text). `normalizeSheetDate` maps that to `YYYY-MM-DD` before grouping; text columns (Project ID, Task ID, etc.) are coerced with `String()` because unformatted numerics arrive as numbers.
- AI Business Tools (`get_timesheet` / `get_timesheet_range`) use the same shared row load via `src/lib/timesheet/canonical-read.ts`.
- Client holiday/leave caches in refs to avoid refetch thrash.

### Validation Rules (load API)

- `weekStart` required `YYYY-MM-DD` or 400.
- Missing session/`staffProfile` → 401.

### API and Integration Behavior

**`GET /api/timesheet/get`**

- Query: `weekStart`
- Success: `{ success: true, data: Record<date, TimeEntry[]> }`
- Upstream: Google Sheets Time Log read

### Data Model Summary

- `TimeEntry { id, projectId, taskId, hours }`
- `DailyTimesheet { date, entries, totalHours }`

### Known Limitations

- Sheets Time Log has no per-day submit flag; UI “unsubmitted week” still shows persisted rows. Canonical AI read returns those rows with `submitted: false`.

### Source Code References

- `src/components/WeeklyTimesheet.tsx`
- `src/app/api/timesheet/get/route.ts`
- `src/lib/timesheet/timesheet-service.ts`
- `src/lib/timesheet/canonical-read.ts`
- `src/lib/google-sheets.ts` (`getTimeLogEntries`, `UNFORMATTED_VALUE`)
- `src/lib/sheets-date.ts` (`normalizeSheetDate`)

### Required tests

- 401 without session
- 400 without weekStart
- Groups and dedupes Time Log rows by staff/date/id
- `src/lib/google-sheets-date.test.ts` — range filter accepts mixed serial + legacy ISO Date cells; Project/Task IDs remain strings

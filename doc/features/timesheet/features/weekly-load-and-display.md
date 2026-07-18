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
- Get API: week end = start + 6 days; filter Sheets rows by `Staff ID`; group by `Date`; dedupe by Time Log ID.
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

- Date range math uses `Date` + `toISOString().split('T')[0]` (UTC date string) — timezone edge cases possible near midnight.

### Source Code References

- `src/components/WeeklyTimesheet.tsx`
- `src/app/api/timesheet/get/route.ts`

### Required tests

- 401 without session
- 400 without weekStart
- Groups and dedupes Time Log rows by staff/date/id

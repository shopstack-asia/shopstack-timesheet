# Copy yesterday

### Overview

On an empty non-FULL-leave day (Tue–Sun), staff can copy the previous day’s entries into the current day with new entry IDs.

### Business Purpose

Speed up repetitive weekly logging.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff | Daily card UI | Copy previous day entries |

### Workflow

1. Show **Copy Yesterday** when `dayIndex > 0`, `day.entries.length === 0`, and day is not FULL leave.
2. On click, clone previous day’s entries with new client IDs into current day (local state only).
3. User must still **Submit Week** to persist to Sheets.

### Screen Behavior

- Button disabled while `submitting`.
- Not shown on Monday (`dayIndex === 0`), when day already has entries, or when FULL leave.
- Holidays do not hide or disable Copy Yesterday.

### Business Logic

- Local state mutation only; no API call.
- Previous day = `dayIndex - 1` in the Mon–Sun array (not calendar “yesterday” across weeks).

### Edge Cases

- Copy into a holiday or weekend day is allowed; user can edit and submit like any other day.

### Source Code References

- `src/components/DailyCard.tsx`
- Parent handler in `src/components/WeeklyTimesheet.tsx`

### Required tests

- Button visibility conditions
- Cloned entries get new ids and same project/task/hours

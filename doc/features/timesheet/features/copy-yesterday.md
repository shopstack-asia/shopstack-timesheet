# Copy yesterday

### Overview

On an empty non-holiday day (Tue–Fri), staff can copy the previous weekday’s entries into the current day with new entry IDs.

### Business Purpose

Speed up repetitive weekly logging.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff | Daily card UI | Copy previous day entries |

### Workflow

1. Show **Copy Yesterday** when `dayIndex > 0`, `day.entries.length === 0`, and day is not a holiday.
2. On click, clone previous day’s entries with new client IDs into current day (local state only).
3. User must still **Submit Week** to persist to Sheets.

### Screen Behavior

- Button disabled while `submitting` or holiday.
- Not shown on Monday (`dayIndex === 0`) or when day already has entries.
- FULL leave does not hide the button by itself in the condition (only holiday + empty + dayIndex); add/edit still disabled when FULL — confirm: Copy Yesterday is shown when `!isHoliday` only; FULL leave days can still show Copy Yesterday if empty. Editing remains disabled via `disabled={isFull || isHoliday}` on forms — copied entries may appear but editing/add blocked until leave ends. **Not confirmed whether copy callback is blocked when isFull** — button only checks `submitting || isHoliday`.

### Business Logic

- Local state mutation only; no API call.
- Previous day = `dayIndex - 1` in the Mon–Fri array (not calendar “yesterday” across weeks).

### Edge Cases

- Copy on FULL leave day may populate entries that cannot be edited until leave state changes; submit may still send them if hours > 0 (UI submit does not check leave).

### Source Code References

- `src/components/DailyCard.tsx`
- Parent handler in `src/components/WeeklyTimesheet.tsx`

### Required tests

- Button visibility conditions
- Cloned entries get new ids and same project/task/hours

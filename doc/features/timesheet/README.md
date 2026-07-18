# Timesheet — feature area

## Purpose

Weekly Mon–Fri time entry UI, load existing Time Log rows, submit/sync to Google Sheets, custom projects, copy yesterday, and leave/holiday day UX.

## Scope

- `src/components/WeeklyTimesheet.tsx`, `DailyCard.tsx`, `TimeEntryForm.tsx`, `SearchableSelect.tsx`
- `src/app/api/timesheet/get/`, `submit/`
- Sheets Time Log helpers in `src/lib/google-sheets.ts`
- Consumes master-data, staff leave, holidays APIs

## Reading order

1. This README
2. [domain-features.md](./domain-features.md)
3. [feature-logic-summary.md](./feature-logic-summary.md)
4. [features/](./features/)
5. Code

## Related areas

- `master-data`, `staff`, `holidays`, `layout`, `auth`

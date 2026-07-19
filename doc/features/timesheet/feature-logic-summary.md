# Timesheet — feature logic summary

| Doc | Description |
|-----|-------------|
| [weekly-load-and-display.md](./features/weekly-load-and-display.md) | Load Mon–Sun week, APIs, grouping, views |
| [weekly-submit-and-sheets-sync.md](./features/weekly-submit-and-sheets-sync.md) | Submit validation + Sheets upsert/delete sync |
| [custom-project-on-submit.md](./features/custom-project-on-submit.md) | `*New` custom project creation |
| [copy-yesterday.md](./features/copy-yesterday.md) | Copy previous day entries |
| [leave-and-holiday-day-ux.md](./features/leave-and-holiday-day-ux.md) | FULL leave blocks edit; holiday/weekend editable with cues |

## Related code

- `src/components/WeeklyTimesheet.tsx`
- `src/components/DailyCard.tsx`
- `src/components/TimeEntryForm.tsx`
- `src/components/SearchableSelect.tsx`
- `src/app/api/timesheet/get/route.ts`
- `src/app/api/timesheet/submit/route.ts`
- `src/lib/google-sheets.ts`
- `src/lib/timesheet/timesheet-service.ts` (`getTimeLogRowsForStaffRange`, `getWeeklyTimesheetForStaff`)
- `src/lib/timesheet/canonical-read.ts` (AI + domain `DailyTimesheet` mapping over the same Time Log rows)
- `src/lib/sheets-write-lock.ts`
- `src/lib/submit-week-days.ts`

# Timesheet — feature logic summary

| Doc | Description |
|-----|-------------|
| [weekly-load-and-display.md](./features/weekly-load-and-display.md) | Load Mon–Sun week, APIs, grouping, views |
| [weekly-submit-and-sheets-sync.md](./features/weekly-submit-and-sheets-sync.md) | Submit validation + Sheets upsert/delete sync |
| [custom-project-on-submit.md](./features/custom-project-on-submit.md) | `*New` custom project creation |
| [copy-yesterday.md](./features/copy-yesterday.md) | Copy previous day entries |
| [leave-and-holiday-day-ux.md](./features/leave-and-holiday-day-ux.md) | Leave/holiday cues; all day types editable; submit ack for FULL leave/holiday |

Slack AI write path reuses the same day writer (`submitDayTimesheetForStaff`) via confirmation-gated Business Tools — see [Timesheet Write Foundation](../business-tools/Timesheet%20Write%20Foundation.md). UI Submit Week has no separate Sheets submitted flag; Slack `prepare_submit_timesheet` is unsupported.

## Related code

- `src/components/WeeklyTimesheet.tsx`
- `src/components/DailyCard.tsx`
- `src/components/TimeEntryForm.tsx`
- `src/components/SearchableSelect.tsx`
- `src/app/api/timesheet/get/route.ts`
- `src/app/api/timesheet/submit/route.ts`
- `src/lib/google-sheets.ts`
- `src/lib/sheets-date.ts` (Time Log Date serial ↔ ISO)
- `src/lib/timesheet/timesheet-service.ts` (`getTimeLogRowsForStaffRange`, `getWeeklyTimesheetForStaff`)
- `src/lib/timesheet/canonical-read.ts` (AI + domain `DailyTimesheet` mapping over the same Time Log rows)
- `src/lib/sheets-write-lock.ts`
- `src/lib/submit-week-days.ts`

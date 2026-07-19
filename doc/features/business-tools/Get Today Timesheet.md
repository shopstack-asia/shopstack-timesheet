# Get Today Timesheet (deprecated)

## Status

**Deprecated.** Removed from the AI-visible tool registry.

Use [`get_timesheet`](./Get%20Timesheet.md) with Bangkok “today” resolved to `YYYY-MM-DD`.

## Compatibility wrapper

`createGetTodayTimesheetTool()` remains exportable for legacy callers. It delegates to the shared daily timesheet load (`loadDailyTimesheet` → canonical Google Sheets Time Log read) for Bangkok today.

No duplicated parsing beyond the thin wrapper.

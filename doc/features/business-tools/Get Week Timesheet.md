# Get Week Timesheet (deprecated)

## Status

**Deprecated.** Removed from the AI-visible tool registry.

Use [`get_timesheet_range`](./Get%20Timesheet%20Range.md) with Bangkok week bounds resolved to `YYYY-MM-DD`.

## Compatibility wrapper

`createGetWeekTimesheetTool()` remains exportable for legacy callers. It delegates to the shared range load (`loadTimesheetRange` → canonical Google Sheets Time Log read) for Bangkok current week (Monday → today) and maps to the legacy week shape.

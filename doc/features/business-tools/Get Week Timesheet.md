# Get Week Timesheet (deprecated)

## Status

**Deprecated.** Removed from the AI-visible tool registry.

Use [`get_timesheet_range`](./Get%20Timesheet%20Range.md) with Bangkok week bounds resolved to `YYYY-MM-DD`.

## Compatibility wrapper

`createGetWeekTimesheetTool()` remains exportable for legacy callers. It delegates to the shared range load for Monday → today (Asia/Bangkok) and maps the result to the legacy week shape (`weekStart`, `days`, `weeklyTotal`, …).

```http
GET /v1/timesheets?startDate=<Mon>&endDate=<today>
X-Employee-Id: <Conversation Context>
```

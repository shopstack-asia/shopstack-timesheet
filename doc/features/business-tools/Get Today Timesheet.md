# Get Today Timesheet (deprecated)

## Status

**Deprecated.** Removed from the AI-visible tool registry.

Use [`get_timesheet`](./Get%20Timesheet.md) with Bangkok “today” resolved to `YYYY-MM-DD`.

## Compatibility wrapper

`createGetTodayTimesheetTool()` remains exportable for legacy callers. It delegates to the shared daily timesheet load:

```http
GET /v1/timesheets?date=<Asia/Bangkok today>
X-Employee-Id: <Conversation Context>
```

No duplicated parsing or API mapping beyond the thin wrapper.

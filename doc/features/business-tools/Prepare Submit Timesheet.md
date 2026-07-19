# Prepare Submit Timesheet

## Tool

`prepare_submit_timesheet`

## Status: unsupported

Weekly Timesheet UI “Submit Week” calls sequential per-day POSTs that upsert/delete Time Log rows via `submitDayTimesheetForStaff`. There is **no** separate submission record, Sheets `submitted` column, or lock flag. Canonical read returns `submitted: false` always.

This tool returns:

```json
{ "status": "unsupported", "message": "..." }
```

Do not invent `submitted=true`. Prefer create/update/delete entry tools.

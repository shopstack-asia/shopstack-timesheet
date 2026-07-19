# Prepare Update Timesheet Entry

## Tool

`prepare_update_timesheet_entry`

## Purpose

Prepare changing an existing Time Log entry. **Does not write Google Sheets.**

## Input

| Field | Required | Notes |
|-------|----------|-------|
| `date` | yes | `YYYY-MM-DD` |
| `entryId` | preferred | From prior `get_timesheet` |
| `matchProjectName` / `matchTaskName` | optional | Locate unique entry within the employee day |
| `hours` / `projectId` / `taskId` | at least one change | |

Entry must belong to the conversation employee’s day. Cross-employee entries are impossible (reader scopes by Staff ID from Conversation Context).

## Behavior

Builds a lossless current full-day snapshot before selecting or changing an entry; incomplete existing rows fail closed. It then validates the full proposed snapshot, preserves all other entries, stores pending asynchronously in Redis, and returns old vs new confirmation text. Redis unavailability returns `unavailable`; prepare never writes Sheets.

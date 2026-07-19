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

Builds proposed full-day snapshot with the selected entry changed; preserves all other entries; stores pending; returns old vs new confirmation text.

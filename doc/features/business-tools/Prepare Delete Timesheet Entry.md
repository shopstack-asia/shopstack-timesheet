# Prepare Delete Timesheet Entry

## Tool

`prepare_delete_timesheet_entry`

## Purpose

Prepare removing one Time Log entry. **Does not write Google Sheets.**

## Input

| Field | Required |
|-------|----------|
| `date` | yes |
| `entryId` or `matchProjectName` | yes (locate within employee day) |

## Behavior

Proposed snapshot = current day without the selected entry. Confirmation required before write.

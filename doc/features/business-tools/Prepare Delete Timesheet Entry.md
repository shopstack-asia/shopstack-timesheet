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

The current day must first build as a lossless snapshot; incomplete existing rows fail closed. Proposed snapshot = current day without the selected entry and is validated before the asynchronous Redis pending-store write. Confirmation is required before any Sheets write; Redis unavailability returns `unavailable`.

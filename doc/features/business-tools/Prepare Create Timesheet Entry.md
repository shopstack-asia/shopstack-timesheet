# Prepare Create Timesheet Entry

## Tool

`prepare_create_timesheet_entry`

## Purpose

Prepare adding one Time Log entry. **Does not write Google Sheets.**

## Input

| Field | Required | Notes |
|-------|----------|-------|
| `date` | yes | `YYYY-MM-DD` |
| `hours` | yes | `> 0` and `≤ 24` |
| `projectId` / `projectName` | one required | Canonical ID preferred |
| `taskId` / `taskName` | one required | Canonical ID preferred |

Identity fields (`employeeId`, `staffId`, `email`, `slackUserId`) are rejected.

## Behavior

1. Load identity from Conversation Context
2. Read current day via canonical reader
3. Resolve Project/Task from master data (`allowCustomProject` path never creates projects)
4. Ambiguous → `clarification_required`; unknown → `validation_failed`
5. Duplicate Project+Task same day → `duplicate_found` (suggest update)
6. Build full proposed day snapshot (existing + new)
7. Store pending change; return `confirmation_required`

## Result statuses

`confirmation_required` | `clarification_required` | `duplicate_found` | `validation_failed`

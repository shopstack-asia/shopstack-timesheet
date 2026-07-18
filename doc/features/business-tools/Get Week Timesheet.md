# Get Week Timesheet

## Tool

`get_week_timesheet`

## Purpose

Return the current week summary: week range, daily totals, weekly total, submission status.

## Flow

```mermaid
sequenceDiagram
  participant U as User
  participant AI as OpenAI
  participant T as get_week_timesheet
  participant C as Business API Client
  participant API as Timesheet API

  U->>AI: How many hours this week?
  AI->>T: execute()
  T->>C: GET /v1/timesheets/week
  C->>API: Bearer request
  API-->>C: WeekTimesheet
  T-->>AI: weekly summary
  AI-->>U: reply
```

## Return fields

| Field | Meaning |
|-------|---------|
| `weekStart` | Week start date |
| `weekEnd` | Optional week end |
| `days` | `{ date, totalHours, submitted? }[]` |
| `weeklyTotal` | Sum of daily totals (or upstream) |
| `submitted` | Week-level submitted flag |
| `submissionStatus` | Optional status string |

## API

| Method | Path |
|--------|------|
| GET | `/v1/timesheets/week` |

## Error cases

Auth / timeout / upstream / malformed → typed ToolResult errors.

## Source Code References

- `src/lib/tools/business/timesheet/get-week-timesheet.ts`

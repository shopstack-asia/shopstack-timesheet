# Get Timesheet Range

## Tool

`get_timesheet_range`

## Purpose

Answer questions spanning **multiple calendar days** (this week, last week, this/last month, custom ranges) after the AI resolves bounds to inclusive `YYYY-MM-DD` dates in `Asia/Bangkok`.

Uses the same **canonical Timesheet read** → Google Sheets Time Log path as `get_timesheet` and the Weekly Timesheet UI.

## Input

```ts
{ startDate: string; endDate: string } // both required, YYYY-MM-DD
```

Rules:

- `startDate` must not be after `endDate`
- Maximum **31** inclusive calendar days
- Do **not** accept `employeeId` or relative date words

## Flow

```mermaid
sequenceDiagram
  participant U as User
  participant AI as OpenAI
  participant T as get_timesheet_range
  participant Ctx as Conversation Context
  participant R as Canonical Timesheet Read
  participant S as Google Sheets Time Log

  U->>AI: สัปดาห์นี้ลงกี่ชั่วโมง
  AI->>AI: Resolve Mon→today Asia/Bangkok
  AI->>T: get_timesheet_range({ startDate, endDate })
  T->>Ctx: getConversationContext()
  Ctx-->>T: employeeId + email
  T->>R: readTimesheetRangeForEmployee(identity, start, end)
  R->>S: getTimeLogEntries(start, end) filter Staff ID
  S-->>R: Time Log rows
  R-->>T: TimesheetRange
  T-->>AI: days + aggregates
  AI-->>U: summary
```

## Data source

Same as [Get Timesheet.md](./Get%20Timesheet.md): `getTimeLogRowsForStaffRange` / Google Sheets **Time Log**. No `GET /v1/timesheets`.

Dates are inclusive. Draft/unsubmitted entries are included.

## Response (`TimesheetRange`)

| Field | Meaning |
|-------|---------|
| `startDate` / `endDate` | Inclusive range |
| `days` | `DailyTimesheet[]` (one per calendar day) |
| `totalHours` | Aggregate hours |
| `expectedHours` | Aggregate expected |
| `remainingHours` | Aggregate remaining |
| `submittedDays` / `unsubmittedDays` | Submission counts |

## Natural-language examples

| User | Tool call (example for 2026-07-19 Bangkok) |
|------|---------------------------------------------|
| สัปดาห์นี้ | `startDate: 2026-07-13`, `endDate: 2026-07-19` |
| สัปดาห์ที่แล้ว | previous Mon–Sun |
| เดือนนี้ | first of month → today |
| เดือนที่แล้ว | first → last of previous month |
| custom ISO range | pass explicit start/end |

## Compatibility

`get_week_timesheet` is a **deprecated** wrapper (not AI-registered) that calls this shared range load for Bangkok current week (Monday → today) and maps to the legacy week shape.

## Code

- `src/lib/timesheet/canonical-read.ts`
- `src/lib/tools/business/timesheet/get-timesheet-range.ts`
- `src/lib/tools/business/timesheet/parse-timesheet-range.ts`
- `src/lib/tools/business/timesheet/bangkok-dates.ts`

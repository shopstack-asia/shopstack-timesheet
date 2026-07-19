# Business Tools — feature logic summary

| Doc | Description |
|-----|-------------|
| [Get My Profile.md](./Get%20My%20Profile.md) | `get_my_profile` — identity diagnostic |
| [Work Context.md](./Work%20Context.md) | `get_work_context` flow and selection rules |
| [Get Timesheet.md](./Get%20Timesheet.md) | `get_timesheet` — single-day read |
| [Get Timesheet Range.md](./Get%20Timesheet%20Range.md) | `get_timesheet_range` — multi-day read |
| [Conversation Context.md](./Conversation%20Context.md) | Ephemeral cache + invalidation |
| [Identity Resolution.md](./Identity%20Resolution.md) | Slack → Zoho employee binding |
| [Get Today Timesheet.md](./Get%20Today%20Timesheet.md) | Deprecated wrapper |
| [Get Week Timesheet.md](./Get%20Week%20Timesheet.md) | Deprecated wrapper |

## Related code

- `src/lib/tools/business/`
- `src/lib/tools/business/profile/get-my-profile.ts`
- `src/lib/timesheet/employee-identity.ts` — Zoho EmployeeID ↔ Time Log Staff ID verification
- `src/lib/timesheet/canonical-read.ts` — shared Sheets Time Log → `DailyTimesheet` / `TimesheetRange`
- `src/lib/timesheet/timesheet-service.ts` — shared row load with Weekly Timesheet UI
- `src/lib/conversation/context/`
- `src/lib/tools/index.ts` — default registry
- `src/lib/ai/prompt.ts` — AI behaviour + Bangkok date rules

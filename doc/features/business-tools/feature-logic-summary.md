# Business Tools — feature logic summary

| Doc | Description |
|-----|-------------|
| [Get My Profile.md](./Get%20My%20Profile.md) | `get_my_profile` — identity diagnostic |
| [Work Context.md](./Work%20Context.md) | `get_work_context` flow and selection rules |
| [Get Timesheet.md](./Get%20Timesheet.md) | `get_timesheet` — single-day read |
| [Get Timesheet Range.md](./Get%20Timesheet%20Range.md) | `get_timesheet_range` — multi-day read |
| [Timesheet Write Foundation.md](./Timesheet%20Write%20Foundation.md) | Confirmation-gated write architecture |
| [Prepare Create Timesheet Entry.md](./Prepare%20Create%20Timesheet%20Entry.md) | `prepare_create_timesheet_entry` |
| [Prepare Update Timesheet Entry.md](./Prepare%20Update%20Timesheet%20Entry.md) | `prepare_update_timesheet_entry` |
| [Prepare Delete Timesheet Entry.md](./Prepare%20Delete%20Timesheet%20Entry.md) | `prepare_delete_timesheet_entry` |
| [Prepare Submit Timesheet.md](./Prepare%20Submit%20Timesheet.md) | `prepare_submit_timesheet` (unsupported) |
| [Confirm Timesheet Change.md](./Confirm%20Timesheet%20Change.md) | `confirm_timesheet_change` |
| [Cancel Timesheet Change.md](./Cancel%20Timesheet%20Change.md) | `cancel_timesheet_change` |
| [Pending Timesheet Change Lifecycle.md](./Pending%20Timesheet%20Change%20Lifecycle.md) | Pending store TTL / claim / statuses |
| [Write Security Boundary.md](./Write%20Security%20Boundary.md) | Identity + no direct-write registry |
| [Conversation Context.md](./Conversation%20Context.md) | Ephemeral cache + invalidation |
| [Identity Resolution.md](./Identity%20Resolution.md) | Slack → Zoho employee binding |
| [Get Today Timesheet.md](./Get%20Today%20Timesheet.md) | Deprecated wrapper |
| [Get Week Timesheet.md](./Get%20Week%20Timesheet.md) | Deprecated wrapper |

## Related code

- `src/lib/tools/business/`
- `src/lib/tools/business/timesheet-write/`
- `src/lib/tools/business/profile/get-my-profile.ts`
- `src/lib/timesheet/timesheet-staff-identity.ts` — pure Staff ID derivation (no Zoho)
- `src/lib/timesheet/canonical-read.ts` — shared Sheets Time Log → `DailyTimesheet` / `TimesheetRange`
- `src/lib/timesheet/timesheet-service.ts` — shared row load/write with Weekly Timesheet UI
- `src/lib/timesheet/write/*` — pending store, prepare/confirm/cancel
- `src/lib/conversation/context/`
- `src/lib/tools/index.ts` — default registry
- `src/lib/ai/prompt.ts` — AI behaviour + Bangkok date + write rules
- `src/lib/ai/write-decision.ts` — write intent routing helpers

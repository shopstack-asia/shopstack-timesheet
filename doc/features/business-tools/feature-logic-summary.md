# Business Tools — feature logic summary

| Doc | Description |
|-----|-------------|
| [Work Context.md](./Work%20Context.md) | `get_work_context` flow and selection rules |
| [Get Timesheet.md](./Get%20Timesheet.md) | `get_timesheet` — single-day read |
| [Get Timesheet Range.md](./Get%20Timesheet%20Range.md) | `get_timesheet_range` — multi-day read |
| [Conversation Context.md](./Conversation%20Context.md) | Ephemeral cache + invalidation |
| [Identity Resolution.md](./Identity%20Resolution.md) | Slack → Zoho employee binding |
| [Get Today Timesheet.md](./Get%20Today%20Timesheet.md) | Deprecated wrapper |
| [Get Week Timesheet.md](./Get%20Week%20Timesheet.md) | Deprecated wrapper |

## Related code

- `src/lib/tools/business/`
- `src/lib/conversation/context/`
- `src/lib/tools/index.ts` — default registry
- `src/lib/ai/prompt.ts` — AI behaviour + Bangkok date rules

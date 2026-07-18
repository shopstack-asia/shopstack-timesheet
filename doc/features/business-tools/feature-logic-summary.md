# Business Tools — feature logic summary

| Doc | Description |
|-----|-------------|
| [Work Context.md](./Work%20Context.md) | `get_work_context` flow and selection rules |
| [Get Today Timesheet.md](./Get%20Today%20Timesheet.md) | `get_today_timesheet` |
| [Get Week Timesheet.md](./Get%20Week%20Timesheet.md) | `get_week_timesheet` |
| [Conversation Context.md](./Conversation%20Context.md) | Ephemeral cache + invalidation |
| [Identity Resolution.md](./Identity%20Resolution.md) | Slack → Zoho employee binding |

## Related code

- `src/lib/tools/business/`
- `src/lib/conversation/context/`
- `src/lib/tools/index.ts` — default registry
- `src/lib/ai/prompt.ts` — AI behaviour

# Business Tools — domain features

| Tool | Purpose |
|------|---------|
| `get_work_context` | User + clients → projects → roles (cached via Conversation Context) |
| `get_timesheet` | One calendar day (`YYYY-MM-DD`): entries, totals, remaining, submitted |
| `get_timesheet_range` | Inclusive date range (max 31 days): daily rows + aggregates |

## Date resolution (AI layer)

- Timezone: `Asia/Bangkok`
- Relative phrases (`today`, `yesterday`, `this week`, Thai equivalents) → explicit ISO dates **before** tool calls
- Ambiguous dates → ask clarification; do not guess across months/years
- Prefer `get_timesheet` for one day; `get_timesheet_range` for multiple days
- Do not call `get_work_context` for pure timesheet reads unless work-context data is needed

## Deprecated wrappers

| Wrapper | Behavior |
|---------|----------|
| `get_today_timesheet` | Calls shared daily implementation with Bangkok today |
| `get_week_timesheet` | Calls shared range implementation with Bangkok Mon→today |

Not listed in the AI-visible default registry.

## Constraints

- Tools use `createBusinessApiClient()` only — never `fetch()`
- Tools use `getConversationContext()` — never Slack/Zoho lookup themselves
- Never accept `employeeId` from AI input
- Read-only (`idempotent: true`)
- Auto-select Client/Project/Role only when exactly one of each
- Never guess; never permanent memory beyond conversation TTL
- No write tools in this phase

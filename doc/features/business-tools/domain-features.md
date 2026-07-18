# Business Tools — domain features

| Tool | Purpose |
|------|---------|
| `get_work_context` | User + clients → projects → roles (cached via Conversation Context) |
| `get_today_timesheet` | Today's entries, totals, remaining hours, submitted |
| `get_week_timesheet` | Week range, daily totals, weekly total, submission status |

## Constraints

- Tools use `createBusinessApiClient()` only — never `fetch()`
- Tools use `getConversationContext()` — never Slack/Zoho lookup themselves
- Never accept `employeeId` from AI input
- Read-only (`idempotent: true`)
- Auto-select Client/Project/Role only when exactly one of each
- Never guess; never permanent memory beyond conversation TTL
- No write tools in this phase

# Business Tools — domain features

| Tool | Purpose |
|------|---------|
| `get_work_context` | User + clients → projects → roles (single CS-Core call) |
| `get_today_timesheet` | Today's entries, totals, remaining hours, submitted |
| `get_week_timesheet` | Week range, daily totals, weekly total, submission status |

## Constraints

- Tools use `createBusinessApiClient()` only — never `fetch()`
- Read-only (`idempotent: true`)
- Auto-select Client/Project/Role only when exactly one of each
- Never guess; never permanent memory
- No write tools in this phase

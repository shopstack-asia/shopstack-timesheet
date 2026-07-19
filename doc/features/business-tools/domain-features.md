# Business Tools — domain features

| Tool | Purpose |
|------|---------|
| `get_my_profile` | Current user’s Conversation Context identity + canonical Time Log Staff ID (`configured` / `missing`) |
| `get_work_context` | User + clients → projects → roles (cached via Conversation Context) |
| `get_timesheet` | One calendar day (`YYYY-MM-DD`) via canonical Sheets Time Log read (same as Weekly Timesheet UI) |
| `get_timesheet_range` | Inclusive date range (max 31 days) via the same canonical read |
| `prepare_create_timesheet_entry` | Prepare add entry (no Sheets write); confirmation required |
| `prepare_update_timesheet_entry` | Prepare update entry (no Sheets write) |
| `prepare_delete_timesheet_entry` | Prepare delete entry (no Sheets write) |
| `prepare_submit_timesheet` | Submit Week — **unsupported** (no separate submitted state in Sheets) |
| `confirm_timesheet_change` | Execute pending change by `confirmationId` via canonical day writer |
| `cancel_timesheet_change` | Cancel pending change (no Sheets write) |

## Date resolution (AI layer)

- Timezone: `Asia/Bangkok`
- Relative phrases (`today`, `yesterday`, `this week`, Thai equivalents) → explicit ISO dates **before** tool calls
- Ambiguous dates → ask clarification; do not guess across months/years
- Prefer `get_timesheet` for one day; `get_timesheet_range` for multiple days
- Do not call `get_work_context` for pure timesheet reads unless work-context data is needed

## Write confirmation

- Prepare tools never mutate Google Sheets
- Confirmation is mandatory; state lives in server-side pending store (TTL 10 min)
- Identity only from Conversation Context; AI cannot supply employeeId/Staff ID
- Full day snapshot replace via `submitDayTimesheetForStaff` (`allowCustomProject: false`)

## Deprecated wrappers

| Wrapper | Behavior |
|---------|----------|
| `get_today_timesheet` | Calls shared daily implementation with Bangkok today |
| `get_week_timesheet` | Calls shared range implementation with Bangkok Mon→today |

Not listed in the AI-visible default registry.

## Constraints

- Timesheet reads use `src/lib/timesheet/canonical-read.ts` → Google Sheets Time Log (not a separate `/v1/timesheets` HTTP API)
- Work-context tools use `createBusinessApiClient()` — never browser `fetch()`
- Tools use `getConversationContext()` — never Slack/Zoho lookup themselves
- Never accept `employeeId` from AI input
- Read tools: `idempotent: true`; write prepare tools are not idempotent; confirm/cancel are idempotent
- Auto-select Client/Project/Role only when exactly one of each
- Never guess; never permanent memory beyond conversation TTL
- No unconfirmed direct-write tools registered for OpenAI
- Empty successful day ≠ integration failure; draft/`submitted: false` entries remain readable

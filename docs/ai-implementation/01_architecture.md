# 01 — Architecture

```text
Slack (DM / app_mention / interactions)
  → POST /api/slack/events | /api/slack/interactions
  → signature verify + waitUntil
  → resolveSlackIdentity (email → Zoho StaffProfile)
  → handleAgentMessage (intent → resolution → merge → pending confirm)
  → timesheetTools adapter
  → src/lib/timesheet/* services
  → Google Sheets / Zoho / Redis (existing)
```

## Key modules

| Path | Role |
|------|------|
| `src/lib/timesheet/` | Reusable services with `AgentAuthContext` |
| `src/lib/timesheet-agent/` | Conversation agent (no Slack I/O) |
| `src/lib/slack/` | Slack client, signature, identity, event handler |
| `src/app/api/slack/*` | HTTP entrypoints |

Browser `POST /api/timesheet/submit` and `GET /api/timesheet/get` call the same timesheet services with `source: 'session'`.

Slack agent tools always call submit with `allowCustomProject: false`. Web submit keeps default `allowCustomProject: true` (existing create-on-unknown behavior).

Slack event dedupe prefers envelope `event_id` (passed from `/api/slack/events`), then `client_msg_id` / `event_ts`.

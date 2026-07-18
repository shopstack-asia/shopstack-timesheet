# Ops — domain features

## Capabilities

1. **Environment catalog** — document all env vars; template in `.env.example`.
2. **Zoho employee test** — `GET /api/debug/zoho-test?email=` lookup employee.
3. **Zoho token test** — `GET /api/debug/zoho-token-test` exercise token refresh.
4. **Slack test** — `GET/POST /api/debug/slack-test` post optional message to configured channels.
5. **Email test** — `GET/POST /api/debug/email-test` send test mail (`to` required).

## Dependencies

- Same Zoho/Slack/SMTP env as production features

## Non-obvious constraints

- No middleware matcher coverage; no bearer/session checks in handlers (as implemented).
- Intended for local/staging diagnosis — not documented as product UX.

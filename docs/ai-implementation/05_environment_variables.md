# 05 — Environment Variables

| Variable | Required for AI | Purpose |
|----------|----------------:|---------|
| `SLACK_BOT_TOKEN` | Yes | Bot API |
| `SLACK_SIGNING_SECRET` | Yes | Request verification |
| `TIMESHEET_AGENT_TIMEZONE` | No (default Asia/Bangkok) | Date resolution |
| `AI_BASE_URL` | No | OpenAI-compatible API base |
| `AI_API_KEY` | No | Model auth |
| `AI_MODEL` | No | Model id |
| `REDIS_URL` / KV_* | Yes | Conversation + pending + locks |
| Existing Zoho / Sheets / NextAuth | Yes | Same as web app |
| `CRON_SECRET` | Prod debug | Protects `/api/debug/*` in production |

See root `.env.example`.

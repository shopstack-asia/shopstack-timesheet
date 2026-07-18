# Environment variables

### Overview

Catalog of environment variables used by the timesheet app. Canonical template: `.env.example` at repo root.

### Business Purpose

Single place for operators to configure auth, Sheets, Zoho, Redis, Slack, SMTP, and cron without root markdown sprawl.

### Workflow

```bash
cp .env.example .env
# edit values, then:
npm run dev
```

Generate secrets: `openssl rand -base64 32` for `NEXTAUTH_SECRET` and `CRON_SECRET`.

### Data Model Summary — env groups

#### Required

| Variable | Purpose |
|----------|---------|
| `PORT` | Dev server port (default 3000); keep aligned with `NEXTAUTH_URL` |
| `NEXTAUTH_URL` | Public app URL for NextAuth |
| `NEXTAUTH_SECRET` | NextAuth JWT secret |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google SSO |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Spreadsheet id from `/d/{ID}/edit` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Sheets service account |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Private key with `\n` escapes, quoted |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REFRESH_TOKEN` | Zoho OAuth |
| `ZOHO_API_DOMAIN` | e.g. `https://people.zoho.com` |
| `CRON_SECRET` | **Required** Bearer token for `/api/cron/*`. Empty/missing → all cron requests rejected (fail closed). |
| `ENABLE_DEBUG_API` | Set `true` to allow `/api/debug/*` in production (also requires `CRON_SECRET`). Default: disabled in production. |

#### Optional — app URLs (reminders)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_APP_URL` / `APP_URL` | **Required** absolute base URL for outbound reminder links. Host header is never trusted. |

#### Optional — holidays location fallbacks

| Variable | Purpose |
|----------|---------|
| `ZOHO_DEFAULT_LOCATION` | Server default location |
| `NEXT_PUBLIC_ZOHO_HOLIDAY_LOCATION` / `NEXT_PUBLIC_DEFAULT_LOCATION` | Client/server fallbacks |

#### Optional — Slack (Friday reminder + Timesheet AI)

| Variable | Purpose |
|----------|---------|
| `SLACK_BOT_TOKEN` | Bot token (`chat:write`, AI bot, reminders) |
| `SLACK_SIGNING_SECRET` | Verify `/api/slack/events` and `/api/slack/interactions` |
| `SLACK_CHANNEL_ID` | Single channel (reminders) |
| `SLACK_CHANNEL_IDS` | Comma-separated channels (preferred for multi) |
| `TIMESHEET_AGENT_TIMEZONE` | Agent date resolution (default `Asia/Bangkok`) |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | Optional OpenAI-compatible intent model |

#### Optional — SMTP (Friday reminder)

| Variable | Purpose |
|----------|---------|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | Mail transport |
| `FROM_EMAIL` | From address |

#### Redis (leave/holiday cache + timesheet Time Log write lock)

Required for **timesheet submit** (fail-closed `503` if lock cannot be acquired). Also used for leave and holiday caching, and **Slack AI conversation / pending-write state**.

| Variable | Purpose |
|----------|---------|
| `REDIS_URL` | Local `redis://…`, Upstash `rediss://default:TOKEN@HOST:6379`, or `https://` host |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel KV / Upstash REST style |
| `KV_REST_API_READ_ONLY_TOKEN` | Read-only REST token if used |

Local Redis: no token. `rediss://` embeds token in URL. `https://` Redis URL needs separate `KV_REST_API_TOKEN`.

Lock key: `timesheet:sheets:timelog:write` (see `src/lib/sheets-write-lock.ts`).

### Security Notes

- Never commit `.env` (gitignored). Use `.env.example` as template only.
- In production, set vars in the host (e.g. Vercel) dashboard.
- `/api/cron/*` fails closed if `CRON_SECRET` is missing/empty; comparison is timing-safe.
- `/api/debug/*` is disabled in production unless `ENABLE_DEBUG_API=true`, and always requires Bearer `CRON_SECRET`.
- Do not put secrets in `next.config.js` `env` (client bundle risk).
- Outbound reminder links use configured `NEXT_PUBLIC_APP_URL` / `APP_URL` only (never Host header).
- Slack AI docs: [`docs/ai-implementation/`](../../../../docs/ai-implementation/).

### Related feature docs

- Auth credentials: [auth/google-oauth-and-zoho-credentials-setup.md](../../auth/features/google-oauth-and-zoho-credentials-setup.md)
- Sheets: [master-data/projects-and-tasks-from-sheets.md](../../master-data/features/projects-and-tasks-from-sheets.md)
- Holidays/Redis: [holidays/holiday-cache-and-read-api.md](../../holidays/features/holiday-cache-and-read-api.md)
- Reminders: [reminders/friday-reminder-notifications.md](../../reminders/features/friday-reminder-notifications.md)

### Source Code References

- `.env.example`
- `src/lib/redis.ts`
- `src/lib/sheets-write-lock.ts`
- `src/lib/auth.ts`
- `src/lib/google-sheets.ts`
- `src/lib/zoho-people.ts`

### Required tests

- N/A (ops catalog)

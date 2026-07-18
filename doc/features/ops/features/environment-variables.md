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
| `CRON_SECRET` | Bearer token for `/api/cron/*` |

#### Optional — app URLs (reminders)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_APP_URL` / `APP_URL` | Preferred timesheet link base for Slack/email |

#### Optional — holidays location fallbacks

| Variable | Purpose |
|----------|---------|
| `ZOHO_DEFAULT_LOCATION` | Server default location |
| `NEXT_PUBLIC_ZOHO_HOLIDAY_LOCATION` / `NEXT_PUBLIC_DEFAULT_LOCATION` | Client/server fallbacks |

#### Optional — Slack (Friday reminder)

| Variable | Purpose |
|----------|---------|
| `SLACK_BOT_TOKEN` | Bot token (`chat:write`) |
| `SLACK_CHANNEL_ID` | Single channel |
| `SLACK_CHANNEL_IDS` | Comma-separated channels (preferred for multi) |

#### Optional — SMTP (Friday reminder)

| Variable | Purpose |
|----------|---------|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | Mail transport |
| `FROM_EMAIL` | From address |

#### Optional — Redis (leave + holiday cache)

| Variable | Purpose |
|----------|---------|
| `REDIS_URL` | Local `redis://…`, Upstash `rediss://default:TOKEN@HOST:6379`, or `https://` host |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel KV / Upstash REST style |
| `KV_REST_API_READ_ONLY_TOKEN` | Read-only REST token if used |

Local Redis: no token. `rediss://` embeds token in URL. `https://` Redis URL needs separate `KV_REST_API_TOKEN`.

### Security Notes

- Never commit `.env` (gitignored). Use `.env.example` as template only.
- In production, set vars in the host (e.g. Vercel) dashboard.

### Related feature docs

- Auth credentials: [auth/google-oauth-and-zoho-credentials-setup.md](../../auth/features/google-oauth-and-zoho-credentials-setup.md)
- Sheets: [master-data/projects-and-tasks-from-sheets.md](../../master-data/features/projects-and-tasks-from-sheets.md)
- Holidays/Redis: [holidays/holiday-cache-and-read-api.md](../../holidays/features/holiday-cache-and-read-api.md)
- Reminders: [reminders/friday-reminder-notifications.md](../../reminders/features/friday-reminder-notifications.md)

### Source Code References

- `.env.example`
- `src/lib/redis.ts`
- `src/lib/auth.ts`
- `src/lib/google-sheets.ts`
- `src/lib/zoho-people.ts`

### Required tests

- N/A (ops catalog)

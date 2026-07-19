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

#### Slack App (server-side only — see `src/lib/slack/config.ts`)

**Never** use `NEXT_PUBLIC_*` for Slack credentials. **Never** put Slack secrets in `next.config.js` `env`. `.env` is gitignored; commit only `.env.example`.

| Variable | Required | Purpose | Default |
|----------|----------|---------|---------|
| `SLACK_APP_NAME` | Optional | Display name | `AI Timesheet` |
| `SLACK_BOT_TOKEN` | **Required*** | Bot user OAuth token (`xoxb-…`) | — |
| `SLACK_SIGNING_SECRET` | **Required*** | Request signature verification | — |
| `SLACK_CLIENT_ID` | **Required*** | Slack app OAuth client id | — |
| `SLACK_CLIENT_SECRET` | **Required*** | Slack app OAuth client secret | — |
| `SLACK_APP_TOKEN` | Optional† | App-level token (`xapp-…`) for Socket Mode | — |
| `SLACK_VERIFICATION_TOKEN` | Optional | Legacy verification token (prefer signing secret) | — |
| `SLACK_EVENTS_PATH` | Optional | Events Request URL path | `/api/slack/events` |
| `SLACK_INTERACTIONS_PATH` | Optional | Interactivity Request URL path | `/api/slack/interactions` |
| `SLACK_COMMANDS_PATH` | Optional | Slash commands Request URL path | `/api/slack/commands` |
| `SLACK_ENABLE_SOCKET_MODE` | Optional | `true` / `false` | `false` |
| `SLACK_ENABLE_APP_HOME` | Optional | Enable `app_home_opened` Home dashboard (`true` / `false`) | `true` |
| `SLACK_ALLOWED_WORKSPACE` | Optional | Restrict to Slack team/workspace id | — |
| `SLACK_LOG_LEVEL` | Optional | `debug` \| `info` \| `warn` \| `error` | `info` |
| `SLACK_VALIDATE_ON_STARTUP` | Optional | `true` = always validate Slack env at process start | unset |

\*Required when Slack is configured for the deployment: set all four, or set `SLACK_VALIDATE_ON_STARTUP=true`. Startup (`src/instrumentation.ts`) also fails if **any** of the four is set but others are missing (partial misconfiguration).  
†Required when `SLACK_ENABLE_SOCKET_MODE=true`.

**Reminder channels** (Friday reminder; not part of `SlackConfig`):

| Variable | Purpose |
|----------|---------|
| `SLACK_CHANNEL_ID` | Single channel |
| `SLACK_CHANNEL_IDS` | Comma-separated channels (preferred for multi) |

**Timesheet AI agent** / **OpenAI conversation**:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | **Required** when conversation AI enabled (startup validates if set) |
| `OPENAI_MODEL` | Chat model (default `gpt-4o-mini`) |
| `OPENAI_MAX_TOKENS` | Max completion tokens (default `512`) |
| `OPENAI_TEMPERATURE` | Sampling temperature (default `0.7`) |
| `OPENAI_TIMEOUT_MS` | Request timeout (default `30000`) |
| `OPENAI_BASE_URL` | Optional OpenAI-compatible base URL |
| `OPENAI_VALIDATE_ON_STARTUP` | `true` = always validate OpenAI env at process start |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | Legacy aliases (still accepted) |
| `TIMESHEET_AGENT_TIMEZONE` | Agent date resolution (default `Asia/Bangkok`) |

**Business API (Timesheet API foundation)**:

| Variable | Purpose |
|----------|---------|
| `BUSINESS_API_BASE_URL` | **Required** when Business API enabled (startup validates if set) |
| `BUSINESS_API_KEY` | Bearer token secret (never log) |
| `BUSINESS_API_TIMEOUT_MS` | Per-request timeout (default `15000`) |
| `BUSINESS_API_RETRY` | Max retries for timeout/network/429/503/504 (default `2`) |
| `BUSINESS_API_LOGGING` | Structured request logs without secrets (default `true`) |
| `BUSINESS_API_VALIDATE_ON_STARTUP` | `true` = always validate Business API env at process start |

##### Local development (Slack)

1. `cp .env.example .env`
2. Create a Slack app; copy Bot Token, Signing Secret, Client ID, Client Secret into `.env` (leave values empty if you are not using Slack locally).
3. Request URLs (HTTP mode): `{NEXTAUTH_URL}{SLACK_EVENTS_PATH}` etc. Use a tunnel (ngrok) for local Events API.
4. Optional: `SLACK_VALIDATE_ON_STARTUP=true` to fail fast on missing Slack vars when starting `npm run dev`.

##### UAT / Production (Slack)

1. Set all **Required*** Slack variables in the host secret store (e.g. Vercel Environment Variables) — never in git.
2. Set `SLACK_VALIDATE_ON_STARTUP=true` on Slack-enabled UAT/Production so cold starts fail closed on missing config.
3. Point Slack app Request URLs at the environment’s public origin + configured paths.
4. Keep `SLACK_ENABLE_SOCKET_MODE=false` for standard HTTP Events/Interactivity on Vercel unless Socket Mode is intentionally used (then set `SLACK_APP_TOKEN`).
5. Rotate tokens if leaked; never log token values (`SlackConfigError` names missing keys only).

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
- **Slack secrets** (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CLIENT_SECRET`, `SLACK_APP_TOKEN`, etc.) are **server-only**. Do not prefix with `NEXT_PUBLIC_`. Do not print them to logs. Load via `src/lib/slack/config.ts` only from server code.
- Slack AI docs: [`docs/ai-implementation/`](../../../../docs/ai-implementation/).

### Related feature docs

- Auth credentials: [auth/google-oauth-and-zoho-credentials-setup.md](../../auth/features/google-oauth-and-zoho-credentials-setup.md)
- Sheets: [master-data/projects-and-tasks-from-sheets.md](../../master-data/features/projects-and-tasks-from-sheets.md)
- Holidays/Redis: [holidays/holiday-cache-and-read-api.md](../../holidays/features/holiday-cache-and-read-api.md)
- Reminders: [reminders/friday-reminder-notifications.md](../../reminders/features/friday-reminder-notifications.md)

### Source Code References

- `.env.example`
- `src/lib/slack/config.ts`
- `src/instrumentation.ts` (Slack startup validation)
- `src/lib/redis.ts`
- `src/lib/sheets-write-lock.ts`
- `src/lib/auth.ts`
- `src/lib/google-sheets.ts`
- `src/lib/zoho-people.ts`

### Required tests

- N/A (ops catalog)

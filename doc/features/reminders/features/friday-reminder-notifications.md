# Friday reminder notifications

### Overview

A secured cron job reminds Shopstack employees to submit weekly timesheets, via personalized email and/or Slack channel posts.

### Business Purpose

Improve Friday timesheet completion before the weekend.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Scheduler / ops with `CRON_SECRET` | Trigger cron | Send reminders |
| Staff | Receive email/Slack | Open timesheet link |

### Workflow

1. Verify `Authorization: Bearer ${CRON_SECRET}` else 401.
2. Best-effort holiday cache refresh.
3. Load all Zoho employees; keep those with email ending `@shopstack.asia`.
4. If `SMTP_HOST` + `SMTP_USER` + `SMTP_PASSWORD`: send HTML email per employee (`Promise.allSettled`).
5. If `SLACK_BOT_TOKEN` and channels from `SLACK_CHANNEL_IDS` (comma) or `SLACK_CHANNEL_ID`: post channel reminder with link.
6. Return `{ success: true }`.

### Use Cases

- Scheduled Friday run (Vercel)
- Manual GET/POST with secret for testing

### Business Logic

**Timesheet URL resolution order**

1. `NEXT_PUBLIC_APP_URL` or `APP_URL` or `NEXTAUTH_URL` → `{url}/timesheet`
2. Else request `x-forwarded-proto` + `host` / `x-forwarded-host`
3. Else placeholder `https://your-domain.com/timesheet`

**Email subject:** `Weekly Timesheet Reminder - Shopstack`  
**Slack:** includes `<!channel>` mention.

### Validation Rules

- Bearer secret required.
- SMTP/Slack sections skipped entirely when env incomplete (not an error).

### Edge Cases

- Empty `CRON_SECRET` accepts only header `Bearer `.
- Email/Slack partial failures swallowed via `allSettled` / catch — overall response can still be success.
- Does not check whether employees already submitted timesheets.

### API and Integration Behavior

| Route | Methods | Auth |
|-------|---------|------|
| `/api/cron/friday-reminder` | POST, GET | Bearer cron |

### Operation Notes

#### Schedule

- Repo `vercel.json`: path `/api/cron/friday-reminder`, schedule **`0 0 * * 5`** (Friday **00:00 UTC**).
- External cron (Upstash/etc.): same URL + header `Authorization: Bearer ${CRON_SECRET}`. Adjust expression if you need local Thailand Friday afternoon.

#### Slack setup (optional)

1. [Slack API apps](https://api.slack.com/apps) → Bot Token Scope `chat:write` → install.
2. `SLACK_BOT_TOKEN=xoxb-…`
3. `SLACK_CHANNEL_ID=C…` or `SLACK_CHANNEL_IDS=C1,C2,C3`

#### SMTP setup (optional)

- Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `FROM_EMAIL`.
- Gmail: use an App Password after 2FA.

#### Secrets / URLs

- `CRON_SECRET` via `openssl rand -base64 32`
- Prefer `NEXT_PUBLIC_APP_URL` or `APP_URL` for correct timesheet links
- Env catalog: [ops/environment-variables.md](../../ops/features/environment-variables.md)

### Known Limitations

- No per-employee Slack DMs — channel broadcast only.
- UTC schedule may not match Thailand local Friday afternoon without adjusting cron expression.

### Source Code References

- `src/app/api/cron/friday-reminder/route.ts`
- `vercel.json`

### Required tests

- 401 without/invalid secret
- Filters non-`@shopstack.asia` emails
- URL prefers env over headers
- Slack channel list parsing from `SLACK_CHANNEL_IDS`

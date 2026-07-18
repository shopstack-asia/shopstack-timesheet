# 13 — Notification and Background Processing

**Confidence:** Confirmed by code

---

## Job inventory

| Job | Schedule | Trigger | Action | Recipients | Retry | Source |
| --- | -------- | ------- | ------ | ---------- | ----- | ------ |
| Friday timesheet reminder | `0 0 * * 5` UTC (Vercel) | Cron POST/GET | Refresh holidays (best effort); email all `@shopstack.asia` employees; Slack channel message | All Zoho employees with Shopstack email; Slack channels | Email/Slack `Promise.allSettled`; holiday refresh errors logged and ignored | `api/cron/friday-reminder`, `vercel.json` |
| Refresh holiday cache | **Not in vercel.json** | Manual/external POST/GET with Bearer | `refreshHolidayCache()` for each location × year (−1..+1) | N/A (cache write) | Per location/year: 3 attempts exponential backoff inside refresh | `api/cron/refresh-holidays`, `holiday-cache.ts` |

---

## Reminder content

**Email (if SMTP_* set):**

- Subject: `Weekly Timesheet Reminder - Shopstack`
- Body: generic reminder for Mon–Fri; button link to `{APP_URL}/timesheet`
- Personalized greeting with FirstName only
- **Does not** list missing days/hours

**Slack (if SLACK_BOT_TOKEN + channel id(s)):**

- `<!channel>` weekly reminder + link
- Supports `SLACK_CHANNEL_ID` or comma-separated `SLACK_CHANNEL_IDS`

---

## Jobs / notifications **not found**

| Item | Status |
|------|--------|
| Submission success notification | Not implemented |
| Approval / rejection notifications | Not implemented |
| Per-employee missing-hours detection | Not implemented |
| Daily reminder job | Not implemented |
| Period locking job | Not implemented |
| Queue workers (Bull/etc.) | Not found — cron HTTP handlers only |
| Idempotency keys for reminders | Not found |

---

## Retry and failure handling

| Component | Behavior |
|-----------|----------|
| Holiday refresh inside Friday job | try/catch; continue reminders |
| Holiday refresh dedicated job | Throws if any location/year fails after retries |
| Email send | `allSettled` — individual failures don’t fail whole batch response necessarily |
| Slack send | per-channel catch + allSettled |
| Time Log write lock | wait/retry 200ms until 45s; then 503 |

---

## Notification channels

| Channel | Config | Used for |
|---------|--------|----------|
| Email SMTP | SMTP_HOST, PORT, USER, PASSWORD, FROM_EMAIL | Friday reminder; debug |
| Slack Web API | SLACK_BOT_TOKEN, CHANNEL_ID(S) | Friday reminder; debug |
| In-app toast/system | — | **Not found** (browser `alert` on submit) |

---

## Time zone behavior

Cron expressed in **UTC**. Recipient local time not adjusted. Reminder at Friday 00:00 UTC may be Thursday evening in US timezones — **Confirmed by vercel.json schedule**; product intent unclear.

---

## Recipient selection

```text
File: src/app/api/cron/friday-reminder/route.ts
Behavior: getAllEmployees() → filter Email endsWith @shopstack.asia → email each; Slack is channel broadcast not DM.
```

# Reminders — domain features

## Capabilities

1. **Cron endpoint** — `POST` and `GET` `/api/cron/friday-reminder` with `Authorization: Bearer ${CRON_SECRET}`.
2. **Holiday refresh side-effect** — best-effort `refreshHolidayCache()`; failures logged; reminder continues.
3. **Email** — if SMTP env present, email each Zoho employee with `@shopstack.asia` email.
4. **Slack** — if bot token + channel id(s), post `<!channel>` reminder to each channel.
5. **Vercel cron** — `0 0 * * 5` (Friday 00:00 **UTC**) hitting friday-reminder path.

## Dependencies

- Zoho `getAllEmployees`
- Optional SMTP / Slack
- App URL envs for link

## Non-obvious constraints

- Not protected by NextAuth middleware (bearer only).
- Schedule in code/config is UTC midnight Friday — differs from some README examples that used `0 17 * * 5`.

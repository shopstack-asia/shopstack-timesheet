# Shopstack Timesheet

Internal timesheet app for Shopstack employees (Next.js, TypeScript, Tailwind).

## Features (summary)

- Google SSO (`@shopstack.asia`) + Zoho People staff profile
- Weekly Mon–Fri timesheet; Google Sheets Time Log
- Leave / holiday awareness; optional Redis cache
- Friday Slack / email reminders (cron)

**Canonical behavior docs:** [`doc/features/`](./doc/features/) — start at [`doc/feature-logic-summary.md`](./doc/feature-logic-summary.md).  
**Agent / engineering rules:** [`doc/ai-agent-instruction.md`](./doc/ai-agent-instruction.md).

## Quick start

```bash
npm install
cp .env.example .env   # fill values — see doc/features/ops/features/environment-variables.md
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Setup details by area:

| Topic | Doc |
|-------|-----|
| Env vars | [ops/environment-variables](./doc/features/ops/features/environment-variables.md) |
| Google + Zoho auth credentials | [auth/google-oauth-and-zoho-credentials-setup](./doc/features/auth/features/google-oauth-and-zoho-credentials-setup.md) |
| Google Sheets tabs / service account | [master-data/projects-and-tasks-from-sheets](./doc/features/master-data/features/projects-and-tasks-from-sheets.md) |
| Friday cron / Slack / SMTP | [reminders/friday-reminder-notifications](./doc/features/reminders/features/friday-reminder-notifications.md) |
| Holiday Redis cache | [holidays/holiday-cache-and-read-api](./doc/features/holidays/features/holiday-cache-and-read-api.md) |

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build & serve |
| `npm run lint` | ESLint (`next lint`) |

## License

Proprietary — Shopstack internal use only.

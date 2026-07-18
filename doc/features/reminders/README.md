# Reminders — feature area

## Purpose

Friday timesheet reminders via email and/or Slack, secured by cron secret; optionally refreshes holiday cache first.

## Scope

- `src/app/api/cron/friday-reminder/route.ts`
- `vercel.json` cron schedule
- SMTP + Slack Web API usage

## Reading order

1. This README
2. [domain-features.md](./domain-features.md)
3. [feature-logic-summary.md](./feature-logic-summary.md)
4. [features/](./features/)
5. Code

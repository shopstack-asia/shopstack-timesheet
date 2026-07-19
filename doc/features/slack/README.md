# Slack — feature area

## Purpose

Slack Events API foundation for AI Timesheet: verified ingress, URL challenge, event dispatch (DM, mention, App Home), responses, and structured logging.

## Scope

- `POST /api/slack/events` HTTP adapter
- Signature + replay verification
- Event dispatcher (`app_mention`, `message.im`, `app_home_opened`)
- Deterministic Slack **App Home** dashboard (read-only)
- App Home Block Kit actions on `POST /api/slack/interactions`
- Typed Slack Events models

## Out of scope (later phases)

- Timesheet editing inside App Home
- Slash commands route
- CS-Core

## Reading order

1. This README
2. [domain-features.md](./domain-features.md)
3. [feature-logic-summary.md](./feature-logic-summary.md)
4. [features/](./features/)
5. Code under `src/lib/slack/` and `src/app/api/slack/`

## Related

- Env catalog: [ops/environment-variables.md](../ops/features/environment-variables.md)
- Config module: `src/lib/slack/config.ts`
- App Home: [features/Slack App Home.md](./features/Slack%20App%20Home.md)

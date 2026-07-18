# Slack — feature area

## Purpose

Slack Events API foundation for AI Timesheet: verified ingress, URL challenge, event dispatch, and structured logging. Future phases add conversation / tools on top of this gateway.

## Scope

- `POST /api/slack/events` HTTP adapter
- Signature + replay verification
- Event dispatcher (`app_mention`, `message.im`)
- Foundation handlers (log-only)
- Typed Slack Events models

## Out of scope (later phases)

- OpenAI / AI conversation
- Redis conversation memory
- Tool calling, leave/timesheet business logic
- App Home, slash commands, interactive buttons

## Reading order

1. This README
2. [domain-features.md](./domain-features.md)
3. [feature-logic-summary.md](./feature-logic-summary.md)
4. [features/](./features/)
5. Code under `src/lib/slack/` and `src/app/api/slack/events/`

## Related

- Env catalog: [ops/environment-variables.md](../ops/features/environment-variables.md)
- Config module: `src/lib/slack/config.ts`

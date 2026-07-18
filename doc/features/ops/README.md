# Ops — feature area

## Purpose

Operational documentation and debug HTTP probes (Zoho, Slack, email). Not end-user product features.

## Scope

- Env catalog: `features/environment-variables.md` + root `.env.example`
- `src/app/api/debug/*`

## Reading order

1. This README
2. [domain-features.md](./domain-features.md)
3. [feature-logic-summary.md](./feature-logic-summary.md)
4. [features/](./features/)
5. Code

## Security note

These routes are **outside** NextAuth middleware and currently have **no authentication** in code. Treat as production risk; restrict at network layer or add auth before exposing publicly.

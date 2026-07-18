# 00 — Implementation Plan (Slack Timesheet AI MVP)

## Sources read

- `docs/ai-discovery/*`, `docs/ai-spec/*`
- Existing: `google-sheets`, `zoho-people`, `auth`, submit/get routes, Redis, friday-reminder Slack usage

## Approach

1. **Extract** reusable timesheet services accepting `StaffProfile` (not NextAuth cookie).
2. **Agent context** — Slack user → email → Zoho profile → `AgentAuthContext`.
3. **Agent runtime** — intent (AI + Zod), resolution, merge, guardrails, Redis conversation/pending state.
4. **Slack** — `/api/slack/events` + `/api/slack/interactions`, signature verify, async `waitUntil`.
5. **Keep** browser APIs behavior-compatible (thin wrappers over services).
6. **Harden** `/api/debug/*` behind `CRON_SECRET` or `NODE_ENV !== production` + secret.
7. **Tests** for merge, resolution, guardrails, confirmation, slack verify.
8. **Docs** under `docs/ai-implementation/`.

## Out of scope

Approval, MCP server transport, inventing APIs, changing Sheets schema.

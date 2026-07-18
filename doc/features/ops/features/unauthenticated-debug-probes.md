# Unauthenticated debug probes

### Overview

HTTP endpoints that exercise Zoho, Slack, and SMTP integrations for operational debugging.

### Business Purpose

Help developers verify credentials and connectivity without using the full timesheet UI.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Anyone who can hit the deployment URL | All `/api/debug/*` (currently) | Run probes |

**This is a known security limitation** — not intentional product authorization.

### Workflow / Use Cases

| Route | Method | Behavior |
|-------|--------|----------|
| `/api/debug/zoho-test` | GET | Optional `email` — fetch employee from Zoho |
| `/api/debug/zoho-token-test` | GET | Refresh/test Zoho OAuth token |
| `/api/debug/slack-test` | GET, POST | Post test message (optional body `message`) to Slack channels |
| `/api/debug/email-test` | GET, POST | Require `to`; send SMTP test |

### Business Logic

- Uses the same server lib clients / env as production paths.
- Responses follow ad-hoc JSON / `ApiResponse` patterns per route (inspect route files when changing).

### Edge Cases

- Misconfigured env returns error payloads that may include upstream messages — avoid exposing in public prod without auth.

### Operation Notes

- Prefer disabling, protecting with secret, or removing in production.
- Not listed in root README features as user-facing.

### Known Limitations

- No auth, rate limit, or IP allowlist in application code.

### Source Code References

- `src/app/api/debug/zoho-test/route.ts`
- `src/app/api/debug/zoho-token-test/route.ts`
- `src/app/api/debug/slack-test/route.ts`
- `src/app/api/debug/email-test/route.ts`
- `src/middleware.ts` (matcher excludes these paths)

### Required tests

- Document expected auth when/if protection is added
- Parameter validation for email-test `to`

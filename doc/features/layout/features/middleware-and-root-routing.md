# Middleware and root routing

### Overview

Unauthenticated users are sent to sign-in; authenticated users land on the timesheet. Middleware enforces NextAuth on selected page and API paths.

### Business Purpose

Keep timesheet data and APIs behind login without protecting cron/debug the same way.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Unauthenticated | Public auth + NextAuth routes | Sign in |
| Authenticated | `/timesheet` + matched APIs | Use app |
| Cron / debug callers | Paths outside middleware matcher | Bearer (cron) or open (debug) |

### Workflow

1. Request `/` → server `getServerSession`; redirect to `/auth/signin` or `/timesheet`.
2. Request matched protected path without session → NextAuth middleware redirect to sign-in.
3. Cron/debug routes skip middleware matcher.

### Business Logic

Middleware matcher (exact from code):

- `/timesheet/:path*`
- `/api/timesheet/:path*`
- `/api/master/:path*`
- `/api/staff/:path*`

### Edge Cases

- Client timesheet page also redirects if `status === 'unauthenticated'` (defense in depth).

### API and Integration Behavior

- No external APIs; NextAuth session cookie only.

### Source Code References

- `src/middleware.ts`
- `src/app/page.tsx`

### Required tests

- Matcher list includes expected prefixes and excludes `/api/cron` and `/api/debug`
- Root redirect branches on session presence

# Route compatibility and deployment safety

### Overview

Existing timesheet URLs and API paths stay in place. New workspace routes are additive. This change does not deploy production.

### Business Purpose

Keep current employees, Slack links, and reminder links working while the shell grows.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Unauthenticated | `/`, `/auth/signin`, `/auth/error` | Sign in |
| Authenticated | Existing timesheet URLs plus new workspace URLs | Use the app |

### Workflow

1. `/` with no session redirects to `/auth/signin`.
2. `/` with a session redirects to `/timesheet`, not `/dashboard`.
3. Google sign-in callback remains `/timesheet`.
4. `/timesheet` is still the weekly timesheet. The page file moved under `src/app/(workspace)/timesheet/`, which does not change the URL.
5. Existing `/api/timesheet/*`, `/api/master/*`, `/api/staff/*`, cron, Slack, and debug paths are unchanged aside from middleware also matching `/dashboard`, `/expense`, and `/api/expense`.

### Use Cases

- A bookmark to `/timesheet` still opens My Timesheet.
- A Friday reminder link still uses `getConfiguredTimesheetUrl()` (`{APP_URL}/timesheet`).

### Screen Behavior

Timesheet week navigation, view mode (`timesheetViewMode`), and the weekly grid are unchanged. The product title in the header is ShopStack Workspace.

### Business Logic

Package name `shopstack-timesheet`, Vercel cron in `vercel.json`, Google Sheets spreadsheet id, and environment variable names for existing integrations are unchanged.

### Validation Rules

Timesheet submit validation is unchanged. See the timesheet feature area.

### Edge Cases

Cron and debug routes stay outside the middleware matcher.

### API and Integration Behavior

Timesheet, master, and staff handlers still use `getServerSession(authOptions)` and `ApiResponse`. Sheets, Zoho, Redis, Slack, and the AI agent are not retargeted.

### Data Model Summary

Time Log columns, task types (`project_delivery`, `sales_presales`, `internal_development`, `internal_operations`), and master ids are unchanged.

### Status Lifecycle

Not applicable.

### Operation Notes

Development branch: `feature/workspace-foundation`, created from `origin/main` with a clean tree.

Do not push this branch, merge it to `main`, or change Vercel production settings unless explicitly asked. Pushing `main` can trigger a production deployment.

Local checks: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.

### Known Limitations

Dashboard is new and is not the post-login landing page.

### Source Code References

- `src/app/page.tsx`
- `src/middleware.ts`
- `src/lib/workspace/routes.ts`
- `src/lib/app-url.ts`
- `vercel.json`

### Required tests

- `AUTHENTICATED_HOME` is `/timesheet`
- Middleware source still lists the original matchers and does not list cron or debug
- Submit route source still names all four task types
- NextAuth remains Google + JWT with `/auth/signin`

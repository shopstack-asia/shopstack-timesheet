# Workspace — domain features

## Capabilities

1. **Branding** — browser title, sign-in, auth error, and header use `ShopStack Workspace`.
2. **Shared layout** — one header and one navigation tree for Dashboard, Timesheet, and Expense.
3. **Navigation config** — `WORKSPACE_NAVIGATION` is the only menu definition. Items can require roles.
4. **Active item** — the longest matching href is current.
5. **Roles** — `EMPLOYEE`, `HR`, `ADMIN`. HR and ADMIN come from Settings → Roles & Permission. Job title and email do not assign them.
6. **Menus** — Expense Management is visible to HR and ADMIN. Settings is visible to ADMIN. Other employees see Dashboard, Timesheet, and Expense.
7. **Server authorization** — `GET /api/expense/management` calls `authorizeExpenseManagement` with the stored assignments. Missing session is 401. A session without HR or ADMIN is 403. Settings and Expense Management pages deny the same roles.
8. **Landing** — authenticated `/` redirects to `/timesheet`.

## Dependencies

- NextAuth session and `staffProfile` (auth)
- Theme context (layout)

## Non-obvious constraints

- `Position` and `@shopstack.asia` do not grant HR or Admin.
- Middleware checks that a session exists. Role checks are separate and run on the server.
- The `(workspace)` route group does not appear in URLs. `/timesheet` is unchanged.
- Timesheet week controls are not part of the shared header.

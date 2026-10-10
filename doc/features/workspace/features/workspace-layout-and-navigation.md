# Workspace layout and navigation

### Overview

Signed-in employees use one header and one menu. The header shows ShopStack Workspace, the staff name, theme toggle, and Sign Out. The menu lists Dashboard, Timesheet, and Expense. Administrator also sees Settings. HR & Financial and Administrator also see Expense Management.

### Business Purpose

Add modules without copying the timesheet header onto every page.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated employee | Dashboard, Timesheet, and Expense | Open those routes |
| HR & Financial | Expense Management | Open those routes |
| Administrator | Settings and Expense Management | Edit role tags and open management routes |

The shell loads roles from `GET /api/workspace/access`. Job title does not add a menu.

### Workflow

1. Middleware requires a NextAuth session for workspace pages.
2. `WorkspaceFrame` reads the session, resolves roles, and filters the menu.
3. `WorkspaceShell` renders the header and the filtered menu.
4. The current path selects the longest matching href.
5. On small screens the menu is closed until Menu is pressed. Changing route closes it.

### Use Cases

- Open My Timesheet from any workspace page.
- Open My Expenses and the monthly claim demo from the same menu. Add expense is a button on My Expenses.

### Screen Behavior

- Header title: ShopStack Workspace.
- Staff line: First name and last name from `staffProfile`.
- Theme and Sign Out match the previous timesheet header actions.
- Desktop: sidebar visible. Mobile: sidebar hidden until Menu is pressed.
- Active link sets `aria-current="page"`.

### Business Logic

Menu source: `WORKSPACE_NAVIGATION`.

| Label | Path | Roles |
|-------|------|-------|
| Dashboard | `/dashboard` | any signed-in employee |
| My Timesheet | `/timesheet` | any signed-in employee |
| My Expenses | `/expense/mine` | any signed-in employee |
| My Monthly Claims | `/expense/claims` | any signed-in employee |
| All Expenses | `/expense/management/expenses` | HR, ADMIN |
| Monthly Summary | `/expense/management/summary` | HR, ADMIN |
| Expense Claims | `/expense/management/claims` | HR, ADMIN |
| Manage Category | `/expense/management/categories` | HR, ADMIN |
| Roles & Permission | `/settings/roles` | ADMIN |

`/expense` redirects to `/expense/mine`. `/expense/requests` and `/expense/requests/new` redirect to the prototype.

### Validation Rules

None. Navigation does not submit data.

### Edge Cases

- No `staffProfile` name: header falls back to the session name or email.
- Unknown paths: no item is current.
- `/expense/management/claims/claim-1` marks `/expense/management/claims` current, because the longer href wins.

### API and Integration Behavior

The shell does not call external APIs. Sign-out uses NextAuth `signOut` with callback `/auth/signin`.

### Data Model Summary

Client preference `theme` is unchanged. Navigation is code, not stored data.

### Status Lifecycle

Not applicable.

### Operation Notes

Local development: `npm run dev`, then sign in. Authenticated `/` opens `/timesheet`.

### Known Limitations

- Expense Management and Settings stay hidden until `/api/workspace/access` returns the matching role.
- Menu items use client-side links, so the header and sidebar stay mounted while the page changes.

### Source Code References

- `src/lib/workspace/navigation.ts`
- `src/components/workspace/layout/WorkspaceShell.tsx`
- `src/components/workspace/layout/WorkspaceFrame.tsx`
- `src/app/(workspace)/layout.tsx`
- `src/app/(workspace)/dashboard/page.tsx`

### Required tests

- Employee menu includes My Expenses and omits Expense Management, Settings, and Add Expense
- HR menu includes Expense Management and omits Settings
- Admin menu includes Settings → Roles & Permission
- Longest href wins for a claim detail under `/expense/management/claims`
- Rendered shell contains ShopStack Workspace, the user label, and `aria-current` on the active timesheet link

# Roles and permission

### Overview

Settings → Roles & Permission stores two role rows: Administrator and HR & Financial. Each row accepts employee codes as tags. Administrator sees Settings and Expense Management. HR & Financial sees Expense Management. Other signed-in employees see neither menu.

### Business Purpose

Assign HR and Admin without reading a job title or an email address.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| EMPLOYEE | Dashboard, Timesheet, My Expenses, My Monthly Claims | No Settings and no Expense Management |
| HR | Expense Management menu and pages | Does not see Settings |
| ADMIN | Settings and Expense Management | Edit role tags, open management routes, and delete any expense or claim |

`S0005` is inserted as Administrator by migration `003_workspace_role_members`. A later save can remove that code.

### Workflow

1. Sign in. The shell calls `GET /api/workspace/access`.
2. The menu hides Settings unless the session employee code is on the Administrator row, and hides Expense Management unless the code is on Administrator or HR & Financial.
3. An Administrator opens Settings → Roles & Permission.
4. The page loads both rows from `GET /api/settings/roles`.
5. Typing an employee code and pressing Enter or comma adds a tag and saves that row. Removing a tag saves the row again.
6. Opening `/settings` or `/expense/management` without the role shows an access-denied message inside the shell.

### Use Cases

- Keep `S0005` as the first Administrator.
- Add another Administrator by typing that employee's code.
- Add HR & Financial codes so those employees see Expense Management only.

### Screen Behavior

The group label is Settings. The item label is Roles & Permission. The page title is Roles & Permission. The two row labels are Administrator and HR & Financial. Tags sit on the right of each row. The input placeholder is Employee code.

### Business Logic

Stored roles are `ADMIN` and `HR`. Every signed-in profile also has `EMPLOYEE`. Position and email do not add a role. One employee code may appear on both rows. Matching ignores surrounding spaces and letter case.

### Validation Rules

An employee code is trimmed, uppercased, and must match one to 32 letters, digits, or hyphens, starting with a letter or digit. A blank value is ignored. A duplicate on the same row is stored once. A code that fails the pattern is rejected and that row is not changed.

### Edge Cases

- `EXPENSE_DATABASE_URL` unset: the shell treats the user as EMPLOYEE, and the settings API returns 503.
- The signed-in Administrator removes their own code: the next menu refresh hides Settings.
- A direct visit to a management or settings URL without the role does not render that page.

### API and Integration Behavior

`GET /api/workspace/access` requires a session and returns `{ success: true, data: { roles } }`. A database failure returns EMPLOYEE only.

`GET /api/settings/roles` and `PUT /api/settings/roles` require Administrator.

| Status | Body |
|--------|------|
| 401 | `{ success: false, error: "Unauthorized" }` |
| 403 | `{ success: false, error: "Settings requires Administrator authorization" }` |
| 400 | `{ success: false, error: "Role is invalid" }` or `{ success: false, error: "Employee code is invalid" }` |
| 503 | `{ success: false, error: "EXPENSE_DATABASE_URL is not configured" }` |
| 200 | `{ success: true, data: { assignments } }` or `{ success: true, data: { assignment } }` |

`PUT` body: `{ "role": "ADMIN" | "HR", "employeeCodes": string[] }`. It replaces that role's codes.

`DELETE /api/expense/entries/:id` deletes any expense when the caller is an Administrator, including a submitted, paid, or cancelled row owned by someone else. Other callers can delete only their own draft.

`DELETE /api/expense/claims/:id` deletes a claim in either status when the caller is an Administrator. The expenses stay and lose the claim link. Anyone else receives 403 `{ success: false, error: "Only an Administrator can delete a claim" }`.

`GET /api/expense/management` uses the same stored assignments. Missing session is 401. A session without HR or ADMIN is 403.

### Data Model Summary

`workspace_role_members` stores `role` and `employee_code` in the expense PostgreSQL database. The migration seeds `('ADMIN', 'S0005')`. Roles are not written onto the session JWT.

### Status Lifecycle

Not applicable.

### Operation Notes

Restart the server after this migration so `003_workspace_role_members` is applied. Middleware also matches `/settings/:path*`, `/api/workspace/:path*`, and `/api/settings/:path*`.

### Known Limitations

My Expenses and My Monthly Claims still load the shared workspace payload and filter it in the browser. Role tags do not change that payload.

### Source Code References

- `src/lib/workspace/roles.ts`
- `src/lib/workspace/role-store.ts`
- `src/lib/workspace/navigation.ts`
- `src/lib/workspace/access.ts`
- `src/app/api/settings/roles/route.ts`
- `src/app/api/workspace/access/route.ts`
- `src/app/(workspace)/settings/roles/page.tsx`
- `src/components/workspace/settings/RoleAssignments.tsx`
- `src/lib/expense/db/migrations.ts`

### Required tests

- Employee codes are trimmed, uppercased, and de-duplicated; a malformed code is rejected
- Settings opens for ADMIN only; Expense Management opens for HR or ADMIN
- An employee menu omits Settings and Expense Management
- An HR menu includes Expense Management and omits Settings
- An Admin menu includes both
- Job title does not grant a role; a stored code does
- Migration `003_workspace_role_members` seeds Administrator `S0005`

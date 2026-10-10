# Role authorization

### Overview

Workspace authorization has three roles: EMPLOYEE, HR, and ADMIN. HR and ADMIN are employee codes stored on Settings → Roles & Permission. Expense Management requires HR or ADMIN. Settings requires ADMIN.

### Business Purpose

Prepare module access without granting HR or Admin from an email address or a Zoho job title.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Unauthenticated | Sign-in only | No workspace pages |
| EMPLOYEE | Timesheet and own expense pages | No Settings and no Expense Management |
| HR | Expense Management pages and `GET /api/expense/management` | Assigned by an employee-code tag |
| ADMIN | Settings, role tags, Expense Management, and delete | Assigned by an employee-code tag. `S0005` is the seeded Administrator. Can delete any expense and any claim |

### Workflow

1. Sign-in still requires `@shopstack.asia` and a Zoho People employee. That behavior is unchanged.
2. `resolveWorkspaceRoles` starts from EMPLOYEE and adds HR or ADMIN when that employee code is stored.
3. The menu shows Expense Management for HR and ADMIN, and Settings for ADMIN.
4. `GET /api/expense/management` calls `authorizeExpenseManagement` with the stored assignments.
5. No session: middleware sends the page to sign-in, and the API returns HTTP 401.
6. Session without HR/ADMIN: the management API returns HTTP 403, and the management pages show access denied.

### Use Cases

- An employee opens `/expense/mine`.
- An employee calls `GET /api/expense/management` and receives 403.
- `S0005`, while stored as Administrator, passes the same check.

### Screen Behavior

The API error says Expense Management requires HR or Admin authorization. Job title and email domain do not grant that role. The management and settings layouts repeat the same role check.

### Business Logic

Allowed management roles: `HR`, `ADMIN`.

`StaffProfile.EmployeeID` is matched to `workspace_role_members.employee_code`. Position is not an authorization role.

### Validation Rules

Authorization fails closed. There is no email allowlist.

### Edge Cases

- Profile missing on an otherwise valid session: still EMPLOYEE, still denied for management.
- Position text such as `HR Manager` or `Admin`: still EMPLOYEE.
- Email `admin@shopstack.asia`: still EMPLOYEE.

### API and Integration Behavior

`GET /api/expense/management`

| Status | Body |
|--------|------|
| 401 | `{ success: false, error: "Authentication required" }` |
| 403 | `{ success: false, error: "Expense Management requires HR or Admin authorization" }` |
| 200 | `{ success: true, data: { module: "expense", status: "not_implemented" } }` |

200 is reachable only when roles include HR or ADMIN. Current sessions do not.

Timesheet API contracts are unchanged.

### Data Model Summary

Role membership is stored in `workspace_role_members`. The resolved list is not stored on the JWT.

### Status Lifecycle

Not applicable.

### Operation Notes

Do not add HR by editing environment variables. Add the employee code on Roles & Permission. Restart the server once so migration `003_workspace_role_members` can seed `S0005`.

### Known Limitations

Zoho People still has no HR or Admin flag. Only codes saved on Roles & Permission pass the check.

### Source Code References

- `src/lib/workspace/authorization.ts`
- `src/lib/auth.ts`
- `src/types/index.ts` (`StaffProfile`)
- `src/app/(workspace)/expense/management/page.tsx`
- `src/app/api/expense/management/route.ts`

### Required tests

- Job title and admin-looking email stay EMPLOYEE
- Missing session is 401
- Employee session is 403
- `canAccessExpenseManagement` is true only for HR or ADMIN
- The API route calls `authorizeExpenseManagement` and `getServerSession`
- An assigned administrator is allowed
- The management page still redirects to Monthly Summary and does not itself grant a role

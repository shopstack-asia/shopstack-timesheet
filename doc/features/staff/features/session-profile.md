# Session staff profile

### Overview

Returns the authenticated user’s Zoho-derived `staffProfile` from the NextAuth session.

### Business Purpose

Expose employee identity to clients that do not already read `useSession()` (optional; current timesheet UI uses session directly).

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated with staffProfile | `GET /api/staff/profile` | Read own profile |
| Authenticated without staffProfile | 404 | — |
| Unauthenticated | 401 | — |

### Workflow

1. `getServerSession(authOptions)`.
2. If no session → 401.
3. If no `staffProfile` → 404.
4. Else `{ success: true, data: staffProfile }`.

### API and Integration Behavior

- No upstream call; session-only.
- Not called by current `WeeklyTimesheet` UI.

### Data Model Summary

- `StaffProfile` in `src/types/index.ts`.

### Source Code References

- `src/app/api/staff/profile/route.ts`

### Required tests

- 401 / 404 / 200 branches

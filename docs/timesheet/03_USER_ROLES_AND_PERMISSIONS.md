# 03 — User Roles and Permissions

**Confidence:** Confirmed by code

---

## Roles actually present

The application does **not** implement a role enumeration (Employee / Manager / HR / Admin). Effective actors:

| Actor ID | Source | How authenticated |
|----------|--------|-------------------|
| `authenticated_employee` | Google OAuth + Zoho People employee record | NextAuth JWT session with `staffProfile` |
| `cron_caller` | Shared secret | `Authorization: Bearer ${CRON_SECRET}` |
| `anonymous_debug` | None | `/api/debug/*` — **no auth** (security gap) |

Zoho `Position` is stored on profile and displayed in UI but **never used for authorization**.

---

## Permission matrix

Actions vs actors (Y = allowed, N = denied/not available, — = not applicable):

| Action | Employee (self) | Employee (other) | Cron | Debug anon |
| ------ | --------------: | ---------------: | ---: | ---------: |
| Sign in if `@shopstack.asia` + Zoho profile | Y | — | — | — |
| View own timesheet week | Y | N | — | — |
| Create/edit draft entries (client) | Y | N | — | — |
| Submit own day to Sheets | Y | N | — | — |
| Delete own day entries via empty `entries` | Y* | N | — | — |
| View another employee’s time log via API | N | N | — | — |
| Approve / reject timesheet | N | N | — | — |
| Unlock period | N | N | — | — |
| Load all projects/tasks | Y | Y (same catalog) | — | — |
| Create `*New` project on submit | Y | — | — | — |
| View own leave | Y | N | — | — |
| View holidays for location | Y | — | — | — |
| Refresh holiday cache | N | N | Y | — |
| Send Friday reminders | N | N | Y | — |
| Call debug email/slack/zoho probes | — | — | — | Y (unrestricted) |

\*UI never posts empty days (skips them); empty `entries` is a server capability.

---

## Role source

```text
Repository: shopstack-timesheet
File: src/lib/auth.ts
Function: signIn callback
Behavior: Deny if email missing, not @shopstack.asia, or Zoho getEmployeeByEmail returns null.
```

Staff fields persisted: `EmployeeID`, `FirstName`, `LastName`, `Nickname`, `Email`, `Position`, `Location?` (`StaffProfile` in `src/types/index.ts`).

---

## Permission keys / guards

| Mechanism | Location | Behavior |
|-----------|----------|----------|
| NextAuth middleware | `src/middleware.ts` | Requires session cookie for `/timesheet`, `/api/timesheet`, `/api/master`, `/api/staff` |
| `getServerSession(authOptions)` | Each protected route | 401 if missing session / staffProfile (submit/get require staffProfile) |
| Staff ID filter | `timesheet/get`, submit writes | Uses `session.staffProfile.EmployeeID` only |
| Cron bearer | cron routes | Exact match `Bearer ${CRON_SECRET}` |

**Not found:** permission keys, CASL/RBAC, project-level ACLs, department isolation, impersonation, service-account user delegation for Timesheet APIs.

---

## Row-level restrictions

| Resource | Rule |
|----------|------|
| Time Log read | Filter `entry['Staff ID'] === session.staffProfile.EmployeeID` |
| Time Log write | Always set Staff ID/Name/Position from session profile |
| Leave | Zoho fetch filtered by session EmployeeID |
| Projects/Tasks | Global catalog — every employee sees all rows |

---

## Ownership rules

- An employee can only load and submit timesheet data as themselves.
- There is **no** API to select another `staffId`.
- Anyone with session can submit any date (past/future) for themselves — no employment-date check.

---

## Administrative overrides

**Not implemented** in application. Spreadsheet editors with Google Drive access can modify Time Log outside the app.

---

## Impersonation

**Not found.**

---

## API authentication requirements

| Route group | Auth |
|-------------|------|
| `/api/auth/*` | NextAuth |
| `/api/timesheet/*`, `/api/master/*`, `/api/staff/*` | Middleware + session (and typically staffProfile) |
| `/api/cron/*` | Bearer `CRON_SECRET` |
| `/api/debug/*` | **None** |

---

## Confidence notes

- Confirmed: single employee actor model, domain + Zoho gate, own-row filtering.
- Not implemented: multi-role matrix cells for Manager/HR/Admin (those roles do not exist in code).

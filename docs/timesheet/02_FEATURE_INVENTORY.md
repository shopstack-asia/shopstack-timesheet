# 02 — Feature Inventory

**Confidence:** Confirmed by code

Status values: **Active** = implemented and reachable; **Partial** = implemented with major gaps; **Not implemented** = searched and absent.

---

## Inventory table

| Feature ID | Feature | User Role | Description | UI | API | Status | Code Evidence |
| ---------- | ------- | --------- | ----------- | -- | --- | ------ | ------------- |
| TS-F-001 | Google SSO domain gate | Employee | Sign in with Google; only `@shopstack.asia`; must exist in Zoho | `/auth/signin` | NextAuth | Active | `src/lib/auth.ts` `signIn` |
| TS-F-002 | Session staff profile | Employee | Zoho profile on JWT/session | Nav + week header | `/api/staff/profile` | Active | `auth.ts`, `staff/profile/route.ts` |
| TS-F-003 | Week navigation | Employee | Prev / current / next week; Mon–Sun | `/timesheet` | — | Active | `src/app/timesheet/page.tsx` |
| TS-F-004 | Column / tab view modes | Employee | Weekly columns or single-day tabs; persisted in localStorage | Timesheet page | — | Active | `timesheetViewMode` key |
| TS-F-005 | Load weekly time log | Employee | Load own entries for week from Sheets | WeeklyTimesheet | `GET /api/timesheet/get` | Active | `timesheet/get/route.ts` |
| TS-F-006 | Load projects & tasks | Employee | All projects/tasks (no assignment filter) | Forms | `GET /api/master/projects`, `/tasks` | Active | master routes + Sheets |
| TS-F-007 | Add / edit / delete entry (draft) | Employee | Client-only until submit | TimeEntryForm | — | Active | `WeeklyTimesheet` handlers |
| TS-F-008 | Client → project → task → hours form | Employee | Cascading client/project; all tasks | TimeEntryForm | — | Active | `TimeEntryForm.tsx` |
| TS-F-009 | Custom project (*New) | Employee | Free-text project under client `*New`; created on submit | TimeEntryForm | submit creates project | Active | `createProject`, submit route |
| TS-F-010 | Copy yesterday | Employee | Append clone of previous day entries | DailyCard | — | Active | `handleCopyYesterday` |
| TS-F-011 | Submit week | Employee | Sequential day POSTs; Sheets upsert/delete | Submit Week button | `POST /api/timesheet/submit` | Active | `submitWeekDaysSequentially`, submit route |
| TS-F-012 | Time Log write lock | System | Redis NX lock around Sheets mutations | — | submit | Active | `sheets-write-lock.ts` |
| TS-F-013 | Leave display & full-day block | Employee | Full leave disables add/edit; half leave warning only | DailyCard | leave monthly API | Partial | UI only; no server enforce |
| TS-F-014 | Holiday display | Employee | Red styling/banner; editing still allowed | DailyCard | `GET /api/timesheet/holidays` | Partial | visual only |
| TS-F-015 | Holiday cache refresh | Cron/ops | Fetch Zoho holidays → Redis | — | `/api/cron/refresh-holidays`, friday-reminder | Active | `holiday-cache.ts` |
| TS-F-016 | Friday reminder blast | Cron | Email all employees + Slack channels | — | `/api/cron/friday-reminder` | Active | friday-reminder route |
| TS-F-017 | Theme toggle | Employee | Light/dark via localStorage | Nav | — | Active | `ThemeContext.tsx` |
| TS-F-018 | Integration debug probes | Ops | Email/Slack/Zoho test endpoints | — | `/api/debug/*` | Active (unauthenticated) | debug routes |

---

## Domains with no features found

| Domain | Status |
|--------|--------|
| Timesheet approval / rejection / return | Not implemented |
| Manager creates entry for employee | Not implemented |
| Period lock / unlock (business) | Not implemented |
| Billable / non-billable | Not implemented |
| Overtime | Not implemented |
| Reporting / export / PDF | Not implemented |
| Per-employee incomplete detection | Not implemented |
| Project–employee assignment filtering | Not implemented |
| Audit history of timesheet changes | Not implemented |
| Idempotent client request keys | Not implemented |

---

## Feature detail cards

### TS-F-005 Load weekly time log

- **Entry point:** `WeeklyTimesheet` after session + master data loading flag
- **Preconditions:** Authenticated with `staffProfile`; `weekStart` Monday ISO date
- **Main flow:** `GET /api/timesheet/get?weekStart=` → Sheets range filter → filter by `Staff ID` → group by date → merge into day cards
- **Validation:** `weekStart` required (400)
- **Permission:** Own EmployeeID only (server filter)
- **Result:** `Record<date, TimeEntry[]>`
- **Errors:** 401, 400, 500
- **Code:** `src/app/api/timesheet/get/route.ts`, `GoogleSheetsService.getTimeLogEntries`

### TS-F-011 Submit week

- **Entry point:** Submit Week button
- **Preconditions:** At least one entry; each entry has projectId, taskId, hours > 0
- **Main flow:** Sequential `POST /api/timesheet/submit` per day with entries → lock → delete removed keys → create custom projects → upsert Time Log → reload week
- **Alternate:** Partial failure — continues other days; alerts failed dates
- **Permission:** Session staff only; writes only as session EmployeeID
- **Side effects:** Sheets row delete/update/append; possible new Projects row; Redis lock
- **Code:** `WeeklyTimesheet.handleSubmitWeek`, `submit-week-days.ts`, `timesheet/submit/route.ts`

### TS-F-013 Leave display & full-day block

- **Entry point:** Month leave load for visible week
- **Preconditions:** EmployeeID in session; Redis or Zoho available
- **Main flow:** Normalize Zoho Days → `isFullLeave` disables form; `isHalfLeave` banner only
- **Validation:** None on leave status (Pending etc. still block if type FULL)
- **Permission:** Own leave only (EmployeeId filter in Zoho fetch)
- **Gap:** Server submit does not check leave
- **Code:** `leave-utils.ts`, `DailyCard.tsx`, `staff/leave/monthly/route.ts`

---

## Grouping by domain

### Time entry / weekly timesheet
TS-F-003 … TS-F-012

### Project / task
TS-F-006, TS-F-008, TS-F-009

### Submission
TS-F-011, TS-F-012

### Working calendar / leave / holidays
TS-F-013, TS-F-014, TS-F-015

### Notifications
TS-F-016

### Administration / ops
TS-F-018, env/config (see ops docs)

### Approval / reporting / billing
None implemented

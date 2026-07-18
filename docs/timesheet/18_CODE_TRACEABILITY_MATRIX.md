# 18 — Code Traceability Matrix

**Confidence:** Confirmed by code

| Feature ID | Feature | UI File | API | Service | Entity/Table | Validation | Permission | Test |
| ---------- | ------- | ------- | --- | ------- | ------------ | ---------- | ---------- | ---- |
| TS-F-001 | Google SSO + domain/Zoho gate | `auth/signin/page.tsx` | `/api/auth/[...nextauth]` | `lib/auth.ts`, `zoho-people.ts` | StaffProfile (JWT) | Domain + Zoho exists | Sign-in gate | None |
| TS-F-002 | Session profile | timesheet nav | `/api/staff/profile` | auth session | StaffProfile | Session | Self | None |
| TS-F-003 | Week navigation | `timesheet/page.tsx` | — | date-fns | — | — | Session page | None |
| TS-F-004 | View modes | `timesheet/page.tsx`, WeeklyTimesheet | — | localStorage | — | column\|tab | Self | None |
| TS-F-005 | Load week time log | WeeklyTimesheet | `GET /api/timesheet/get` | `google-sheets.getTimeLogEntries` | Time Log sheet | weekStart required | Own Staff ID | None |
| TS-F-006 | Load projects/tasks | WeeklyTimesheet, TimeEntryForm | `/api/master/projects`, `/tasks` | `getCachedProjects/Tasks` | Projects, Roles and Tasks | Session | All employees | None |
| TS-F-007 | Draft add/edit/delete | WeeklyTimesheet, TimeEntryForm, DailyCard | — | React state | TimeEntry | UI touched rules | Self UI | None |
| TS-F-008 | Cascading form | TimeEntryForm, SearchableSelect | — | — | Project/Task | Client/project/task/hours | Self | None |
| TS-F-009 | Custom *New project | TimeEntryForm | submit | `createProject` | Projects sheet | projectId string | Employee submit | None |
| TS-F-010 | Copy yesterday | DailyCard, WeeklyTimesheet | — | handleCopyYesterday | TimeEntry | Preconditions | Self | None |
| TS-F-011 | Submit week | WeeklyTimesheet | `POST /api/timesheet/submit` | submit-week-days + Sheets upsert/delete | Time Log | Zod + task map + UI | Own EmployeeID | `submit-week-days.test.ts` |
| TS-F-012 | Sheets write lock | — | submit | `sheets-write-lock.ts`, redis | Redis lock key | Lock timeout | System | `sheets-write-lock.test.ts` |
| TS-F-013 | Leave UX block | DailyCard, WeeklyTimesheet | `/api/staff/leave/monthly` | leave-utils, zoho, redis | LeaveDayEntry | Frontend full leave | Own leave | None |
| TS-F-014 | Holiday display | DailyCard, WeeklyTimesheet | `/api/timesheet/holidays` | holiday-cache | Holiday Redis | year param | Session | None |
| TS-F-015 | Holiday refresh | — | `/api/cron/refresh-holidays`, friday-reminder | `refreshHolidayCache`, getYearlyHolidays | Redis holidays | CRON_SECRET | Cron | None |
| TS-F-016 | Friday reminder | — | `/api/cron/friday-reminder` | zoho, nodemailer, slack | Employees | CRON_SECRET | Cron | None |
| TS-F-017 | Theme toggle | timesheet page, ThemeContext | — | localStorage | — | — | Self | None |
| TS-F-018 | Debug probes | — | `/api/debug/*` | various | — | Minimal | **None** | None |

### Not implemented features (traceability)

| Feature | UI | API | Service | Test |
|---------|----|-----|---------|------|
| Approve/reject | — | — | — | — |
| Reporting/export | — | — | — | — |
| RBAC roles | — | — | — | — |
| Period lock (business) | — | — | — | — |
| Billable/OT | — | — | — | — |

---

## Test coverage note

Automated tests cover **helper units only**, not API/UI/business rules end-to-end. See [19](./19_GAPS_AMBIGUITIES_AND_TECHNICAL_DEBT.md) and rule/test matrix in section below.

### Rule / feature vs tests

| Rule / Feature | Test Exists | Test File | Coverage Notes |
| -------------- | ----------: | --------- | -------------- |
| Sequential day submit | Yes | `src/lib/submit-week-days.test.ts` | Order, skip empty, continue on failure |
| Redis write lock | Yes | `src/lib/sheets-write-lock.test.ts` | Acquire, timeout, redis errors, release |
| Zod submit validation | No | — | — |
| Leave full-day UI | No | — | — |
| Auth domain gate | No | — | — |
| Sheets upsert/delete | No | — | — |
| Custom project create | No | — | — |
| Cron reminder | No | — | — |
| Approval workflow | N/A | — | Not implemented |

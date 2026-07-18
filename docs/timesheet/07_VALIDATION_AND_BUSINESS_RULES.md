# 07 — Validation and Business Rules

**Confidence:** Confirmed by code. Layer: F = frontend, B = backend, Both, DB = Sheets constraints (none enforced by Google beyond app logic).

---

## Rules table

| Rule ID | Rule | Trigger | Condition | Result | Error Message | Source | Layer |
| ------- | ---- | ------- | --------- | ------ | ------------- | ------ | ----- |
| TS-BR-001 | Email domain must be Shopstack | Sign-in | `email.endsWith('@shopstack.asia')` | Deny sign-in | NextAuth AccessDenied | `auth.ts` | B |
| TS-BR-002 | Employee must exist in Zoho | Sign-in | `getEmployeeByEmail` returns profile | Deny if null/error | AccessDenied | `auth.ts` | B |
| TS-BR-003 | Session required for timesheet APIs | API | No session / no staffProfile (get/submit) | 401 | `Unauthorized` | get/submit routes | B |
| TS-BR-004 | weekStart required | GET get | Missing query | 400 | `weekStart parameter is required` | get route | B |
| TS-BR-005 | Date format YYYY-MM-DD | POST submit | Zod regex | 400 | Validation error | submit Zod | B |
| TS-BR-006 | projectId min length 1 | POST submit | Zod | 400 | Validation error | submit Zod | B |
| TS-BR-007 | taskId min length 1 | POST submit | Zod | 400 | Validation error | submit Zod | B |
| TS-BR-008 | Hours between 0 and 24 inclusive | POST submit | Zod `.min(0).max(24)` | 400 | Validation error | submit Zod | B |
| TS-BR-009 | Task must exist in master tasks | POST submit | `taskMap.has(taskId)` | 400 | `Invalid task ID: …` | submit route | B |
| TS-BR-010 | Project ID may be custom name | POST submit | Not in projectMap → createProject | Create Sheets project | — | submit + google-sheets | B |
| TS-BR-011 | Empty entries allowed (delete day) | POST submit | `entries.length === 0` | Delete all day rows | — | submit comment + logic | B |
| TS-BR-012 | Write lock must acquire | POST submit | Redis NX wait ≤45s | 503 | busy / lock unavailable | sheets-write-lock | B |
| TS-BR-013 | Client required (UI) | Form touch / submit week | selectedClient empty | Show error / block submit alert | Client is required / complete fields | TimeEntryForm, handleSubmitWeek | F |
| TS-BR-014 | Project required (UI) | Form / submit week | projectId empty | Block | Project is required | TimeEntryForm | F |
| TS-BR-015 | Task required (UI) | Form / submit week | taskId empty | Block | Task is required | TimeEntryForm | F |
| TS-BR-016 | Hours must be > 0 (UI submit) | Submit week | `hours <= 0` | Block | complete fields alert; Hours must be greater than 0 | WeeklyTimesheet, TimeEntryForm | F |
| TS-BR-017 | Hours input max 24 (UI) | Input | HTML max=24 | Browser constraint | — | TimeEntryForm | F |
| TS-BR-018 | Full leave disables editing | Render day | `isFullLeave` | Disable add/edit/delete | Leave Day button | DailyCard | F only |
| TS-BR-019 | Half leave does not disable editing | Render day | `isHalfLeave` | Banner only | — | DailyCard | F |
| TS-BR-020 | Holiday does not disable editing | Render day | holiday match | Styling only | — | DailyCard | F |
| TS-BR-021 | Copy yesterday only if empty & not Mon & not full leave | Render | dayIndex>0, entries.length===0, !isFull | Show button | — | DailyCard | F |
| TS-BR-022 | Skip empty days on week submit | Submit week | entries.length===0 | No POST for that day | — | submit-week-days | F |
| TS-BR-023 | Cron requires Bearer secret | Cron routes | header !== Bearer CRON_SECRET | 401 | Unauthorized | friday-reminder, refresh-holidays | B |
| TS-BR-024 | Leave monthly needs EmployeeID | Leave API | missing EmployeeID | 404 | EmployeeID not found… | leave monthly | B |
| TS-BR-025 | Middleware protects path prefixes | Request | matcher paths | Redirect/login | NextAuth | middleware.ts | B |

---

## Rules searched but **not implemented**

| Topic | Status |
|-------|--------|
| Past/future date limits | Not implemented |
| Weekend blocked | Not implemented (`isWeekday` exists in utils but unused by submit) |
| Holiday blocks submit | Not implemented (UI visual only) |
| Leave blocks submit (server) | Not implemented |
| Filter leave by Approved only | Not implemented (all statuses normalized) |
| Locked period | Not implemented |
| Closed/inactive project | Not implemented |
| Employee assignment to project | Not implemented |
| Daily sum ≤ 24 | Not implemented |
| Weekly hour cap | Not implemented |
| Overtime rules | Not implemented |
| Duplicate entry reject | Not implemented (upsert instead) |
| Overlapping time ranges | Not implemented |
| Description required | Not implemented |
| Billing restrictions | Not implemented |
| Employment / termination dates | Not implemented |
| Submission deadline | Not implemented |
| Time zone business rules | Not implemented (local Date / ISO strings) |
| Midnight crossing | N/A (hours only) |

---

## Frontend-only enforcement (important)

| Rule | Risk if API called directly |
|------|------------------------------|
| TS-BR-013 Client required | Client never sent; bypass trivial |
| TS-BR-016 Hours > 0 | Server allows 0 |
| TS-BR-018 Full leave disable | Server accepts submit on leave days |
| Holiday visual | Server accepts holiday dates |
| TS-BR-022 Skip empty days | Cannot clear a day via UI week submit |

---

## Where validation occurs (summary)

| Concern | Frontend | Backend | Sheets/DB constraint |
|---------|----------|---------|----------------------|
| Auth domain/Zoho | — | Yes | — |
| Entry shape | Yes | Zod | — |
| Task existence | Indirect (dropdown) | Yes | — |
| Project existence | Dropdown or custom | Custom create | — |
| Hours range | max 24, >0 on submit | 0–24 | — |
| Leave/holiday | UI only | No | — |
| Concurrent writes | Sequential days | Redis lock | — |

---

## Confidence

- Table rows: Confirmed by code.
- Unused `isWeekday`: Confirmed present in `src/lib/utils.ts`, no import from submit/UI paths (Inferred from codebase search during analysis).

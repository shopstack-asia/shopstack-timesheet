# 12 — UI Screen and Behavior Specification

**Confidence:** Confirmed by code

---

## Screen inventory

| Screen ID | Name | Route | Status |
|-----------|------|-------|--------|
| UI-01 | Home redirect | `/` | Active |
| UI-02 | Sign in | `/auth/signin` | Active |
| UI-03 | Auth error | `/auth/error` | Active |
| UI-04 | Weekly timesheet shell | `/timesheet` | Active |
| UI-05 | Weekly column view | part of UI-04 | Active |
| UI-06 | Daily tab view | part of UI-04 | Active |
| — | Approval inbox | — | **Not found** |
| — | Reports / admin / holiday setup UI | — | **Not found** |

---

## UI-01 Home

```text
Screen ID: UI-01
Route: /
Purpose: Redirect authenticated users to /timesheet else /auth/signin
Code: src/app/page.tsx
```

---

## UI-02 Sign in

```text
Screen ID: UI-02
Route: /auth/signin
User Role: anonymous → employee
Purpose: Google sign-in
Actions: Sign in with Google
Error State: AccessDenied messaging for non-domain / missing Zoho
API Calls: NextAuth signIn('google')
Code: src/app/auth/signin/page.tsx
```

---

## UI-03 Auth error

```text
Route: /auth/error
Purpose: Display NextAuth error codes; AccessDenied troubleshooting
Code: src/app/auth/error/page.tsx
```

---

## UI-04 Timesheet shell

```text
Screen ID: UI-04
Screen Name: Shopstack Timesheet
Route: /timesheet
User Role: authenticated_employee
Purpose: Week navigation + theme + sign out + host WeeklyTimesheet
Entry Conditions: Session required (middleware + client redirect)
Displayed Data: Staff name; week date range
Actions:
  - Previous / Current Week / Next
  - Toggle light/dark theme
  - Sign Out
  - View mode icons (column | tab) via child
Fields: none (navigation only)
Loading State: “Loading...” while session loading
Permission Behavior: unauthenticated → redirect signin
API Calls: none directly (child loads data)
Components: TimesheetPage, WeeklyTimesheet, ThemeContext
localStorage: timesheetViewMode, theme
Code: src/app/timesheet/page.tsx
```

---

## UI-05 / UI-06 WeeklyTimesheet + DailyCard

```text
Screen ID: UI-05 / UI-06
Purpose: Edit and submit weekly hours
Displayed Data:
  - Staff name/position, week of, week total hours
  - Per day: date, total hours, entries, leave banner, holiday banner
Actions:
  - Submit Week (disabled if weekTotalHours === 0 or submitting)
  - View mode toggle column/tab
  - Tab mode: day selector buttons (color by holiday/leave)
  - Per day: Add Entry, Copy Yesterday (conditional), edit/delete entry fields
Fields per entry: Client, Project (or New text), Task, Hours
Validation: See TS-BR-013–017; submit alert for incomplete days
Button Behavior:
  - Submit shows Submitting... while in flight
  - Full leave: Add disabled “Leave Day”; forms disabled
Loading State: full-page Loading until master data fetch completes
Empty State: empty day cards with Add Entry
Error State: console errors; alerts on submit failure; holidays/leave failures soft-fail
API Calls:
  GET /api/master/projects, /api/master/tasks
  GET /api/timesheet/get?weekStart=
  GET /api/staff/leave/monthly?year=&month=
  GET /api/timesheet/holidays?year=
  POST /api/timesheet/submit (per day)
Components: WeeklyTimesheet, DailyCard, TimeEntryForm, SearchableSelect
Code: src/components/WeeklyTimesheet.tsx, DailyCard.tsx, TimeEntryForm.tsx
```

### Visual status cues

| Condition | Card / tab styling |
|-----------|-------------------|
| Holiday | Red tones + banner |
| Full leave | Orange tones + disable edit |
| Half leave | Yellow tones + editable |
| Normal | Gray/white card |

---

## Screens not present

Daily-only dedicated route, calendar month view, entry detail modal, submission confirmation page, approval inbox, manager view, employee summary report, admin configuration, project setup UI, working calendar setup, holiday setup UI, notification settings UI — **Not found**. Project/holiday master data is maintained in Google Sheets / Zoho / cron, not in-app admin screens.

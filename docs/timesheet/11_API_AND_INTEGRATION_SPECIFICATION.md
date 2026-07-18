# 11 — API and Integration Specification

**Confidence:** Confirmed by code

Envelope for business APIs: `ApiResponse<T> = { success: boolean; data?: T; error?: string }`.

---

## API inventory

| Method | Endpoint | Purpose | Role | Request | Response | Source |
| ------ | -------- | ------- | ---- | ------- | -------- | ------ |
| GET/POST | `/api/auth/[...nextauth]` | NextAuth | — | OAuth | Session | nextauth route |
| GET | `/api/timesheet/get` | Load week entries | Employee | `weekStart` | `Record<date, TimeEntry[]>` | get/route.ts |
| POST | `/api/timesheet/submit` | Upsert/delete day | Employee | `{date, entries[]}` | void | submit/route.ts |
| GET | `/api/timesheet/holidays` | Holidays from Redis | Employee | `year?` | `Holiday[]` | holidays/route.ts |
| GET | `/api/master/projects` | Projects + clients | Employee | — | `{projects, clients}` | projects/route.ts |
| GET | `/api/master/tasks` | Tasks | Employee | — | `Task[]` | tasks/route.ts |
| GET | `/api/staff/profile` | Session profile | Employee | — | StaffProfile | profile/route.ts |
| GET | `/api/staff/leave` | Leave range | Employee | `from?`,`to?` | LeaveDayEntry[] | leave/route.ts |
| GET | `/api/staff/leave/monthly` | Leave month | Employee | `year?`,`month?` | LeaveDayEntry[] | monthly/route.ts |
| GET | `/api/staff/leave/yearly` | Leave year | Employee | `year?` | LeaveDayEntry[] | yearly/route.ts |
| POST/GET | `/api/cron/friday-reminder` | Reminders + holiday refresh | Cron | Bearer | void | friday-reminder |
| POST/GET | `/api/cron/refresh-holidays` | Holiday cache only | Cron | Bearer | void | refresh-holidays |
| GET/POST | `/api/debug/email-test` | SMTP probe | **None** | `to` | varies | email-test |
| GET/POST | `/api/debug/slack-test` | Slack probe | **None** | — | varies | slack-test |
| GET | `/api/debug/zoho-test` | Employee by email | **None** | `email` | varies | zoho-test |
| GET | `/api/debug/zoho-token-test` | Token smoke | **None** | — | varies | zoho-token-test |

UI primarily uses: get, submit, holidays, master projects/tasks, leave **monthly**.

---

## Endpoint specifications (core)

### GET `/api/timesheet/get`

```text
Method: GET
Path: /api/timesheet/get
Purpose: Return session user’s Time Log entries for Mon–Sun week
Authentication: Session + staffProfile
Permission: Own Staff ID filter
Query Parameters: weekStart (YYYY-MM-DD) required
Request Body: none
Response Body: { success, data: Record<string, TimeEntry[]> }
Validation: weekStart present
Status Codes: 200, 400, 401, 500
Side Effects: none (read Sheets)
Code: src/app/api/timesheet/get/route.ts
```

### POST `/api/timesheet/submit`

```text
Method: POST
Path: /api/timesheet/submit
Purpose: Replace day’s entries for session user in Time Log
Authentication: Session + staffProfile
Permission: Writes only as session EmployeeID
Request Body:
  {
    "date": "YYYY-MM-DD",
    "entries": [ { "projectId": string, "taskId": string, "hours": number } ]
  }
Response Body: { success: true } | { success: false, error }
Validation: Zod date; entries projectId/taskId min1; hours 0–24; tasks must exist
Status Codes: 200, 400, 401, 503 (lock), 500
Business Errors: Invalid task ID; Project not found (thrown); lock timeout/unavailable
Side Effects: Sheets delete/upsert; maybe create Project; Redis lock; cache clear on create
Code: src/app/api/timesheet/submit/route.ts
```

### GET `/api/timesheet/holidays`

```text
Authentication: Session
Query: year (default current)
Location: session Location or ZOHO_DEFAULT_LOCATION / NEXT_PUBLIC_* defaults
Data: Redis cache only via getCachedHolidays
Errors: 401, 400 invalid year, 500 cache failure message
```

### GET `/api/master/projects` / `/api/master/tasks`

```text
Authentication: Session (staffProfile not strictly required in projects route — session only)
Response projects: { projects: Project[], clients: string[] }
Response tasks: Task[]
Side Effects: may refresh 5-min in-process cache
```

### GET `/api/staff/leave/monthly`

```text
Auth: Session + EmployeeID
Query: year, month (1–12)
Cache: leave:{id}:{from}:{to} TTL 21600
Upstream: Zoho fetchLeaveRecords then normalizeZohoLeaveRecords
```

### Cron routes

```text
Auth: Authorization: Bearer ${CRON_SECRET}
friday-reminder: refresh holidays best-effort; email all @shopstack.asia; Slack channels
refresh-holidays: refreshHolidayCache only
Also accept GET → same as POST for manual testing
```

---

## Integrations matrix

| System | Status | Evidence | Notes |
|--------|--------|----------|-------|
| Google OAuth | Active | `auth.ts` GoogleProvider | Domain restricted |
| Google Sheets | Active | `google-sheets.ts` | Primary datastore |
| Zoho People | Active | `zoho-people.ts`, holidays | Profile, leave, holidays, employees |
| Redis / Upstash / KV | Active | `redis.ts` | Leave, holidays, write lock |
| Slack | Partial / Optional | friday-reminder, debug | Channel blast only |
| SMTP Email | Partial / Optional | friday-reminder, debug | Nodemailer |
| Jira | Not found | — | — |
| Google/Microsoft Calendar | Not found | — | — |
| HR beyond Zoho | Not found | — | — |
| Payroll / Billing / Finance APIs | Not found | — | May consume Sheets offline |
| Attendance API | Legacy types/helpers | leave-utils legacy | Not used by monthly leave path |
| Identity beyond Google | Not found | — | — |

---

## External API calls (server-only)

Confirmed BFF pattern: client calls `/api/*` only; Sheets/Zoho/Slack/SMTP from `src/lib` and route handlers.

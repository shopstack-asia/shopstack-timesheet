# 01 — Existing APIs (Timesheet-related)

**Source of truth:** application code under `src/app/api/` and `src/lib/`  
**Analyzed:** branch `main`, commit `e8af4c6095ffcc6131f8beed890719bd3bc4d9ca`  
**Architecture note:** There is no MVC Controller/Service layer. Each endpoint is a Next.js Route Handler; persistence/integration lives in `src/lib/*`. Shared envelope: `ApiResponse<T> = { success: boolean; data?: T; error?: string }` (`src/types/index.ts`).

**Named DTO classes:** Not present. Request/response shapes are inline Zod schemas and TypeScript interfaces.

---

## Categorization summary

| Category | Endpoints found |
|----------|-----------------|
| Read APIs | Yes — get week, holidays, projects, tasks, profile, leave×3 |
| Create APIs | **No dedicated create-entry API.** Custom project may be created as a side effect of submit. |
| Update APIs | **No dedicated update-entry API.** Day submit upserts matching Time Log keys. |
| Delete APIs | **No dedicated delete-entry API.** Day submit deletes omitted Project\|Task keys; `entries: []` deletes all for day. |
| Submit APIs | Yes — `POST /api/timesheet/submit` |
| Approval APIs | **None** |
| Reporting APIs | **None** |

Cron and debug routes are listed under ancillary (not employee timesheet CRUD).

---

## Read APIs

### GET `/api/timesheet/get`

| Field | Value |
|-------|--------|
| HTTP Method | GET |
| URL | `/api/timesheet/get` |
| Controller | `src/app/api/timesheet/get/route.ts` → `GET` |
| Service | `getGoogleSheetsService()` → `GoogleSheetsService.getTimeLogEntries` (`src/lib/google-sheets.ts`) |
| Request DTO | Query: `weekStart: string` (YYYY-MM-DD, Monday expected by UI) |
| Response DTO | `ApiResponse<Record<string, TimeEntry[]>>` where `TimeEntry = { id, projectId, taskId, hours }` |
| Authentication | NextAuth session; requires `session.staffProfile` |
| Permission | Returns only rows where `Staff ID === session.staffProfile.EmployeeID` |
| Validation | `weekStart` required → 400 if missing |
| Business Rules | Computes week end = start + 6 days; dedupes by Time Log ID; no leave/holiday filter |
| Middleware | Protected (`/api/timesheet/:path*`) |

**Example request**

```http
GET /api/timesheet/get?weekStart=2026-07-13
Cookie: next-auth.session-token=...
```

**Example response**

```json
{
  "success": true,
  "data": {
    "2026-07-14": [
      {
        "id": "a1b2c3d4e5f67890",
        "projectId": "12",
        "taskId": "3",
        "hours": 4
      }
    ]
  }
}
```

---

### GET `/api/timesheet/holidays`

| Field | Value |
|-------|--------|
| HTTP Method | GET |
| URL | `/api/timesheet/holidays` |
| Controller | `src/app/api/timesheet/holidays/route.ts` → `GET` |
| Service | `getCachedHolidays` (`src/lib/holiday-cache.ts`) — Redis only |
| Request DTO | Query: `year?: string` (default current year) |
| Response DTO | `ApiResponse<Holiday[]>` |
| Authentication | Session required |
| Permission | Location from `session.staffProfile.Location` or env defaults; no cross-user data |
| Validation | year must parse and be ≥ 2000 |
| Business Rules | Does not call Zoho live; fails if cache missing |

**Example request**

```http
GET /api/timesheet/holidays?year=2026
```

**Example response**

```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "name": "New Year's Day",
      "date": "2026-01-01",
      "is_holiday": true
    }
  ]
}
```

---

### GET `/api/master/projects`

| Field | Value |
|-------|--------|
| HTTP Method | GET |
| URL | `/api/master/projects` |
| Controller | `src/app/api/master/projects/route.ts` → `GET` |
| Service | `getCachedProjects()` → Sheets `Projects!A2:D` |
| Request DTO | none |
| Response DTO | `ApiResponse<{ projects: Project[]; clients: string[] }>` |
| Authentication | Session |
| Permission | All authenticated users receive full catalog |
| Validation | none beyond auth |
| Business Rules | Clients = unique sorted `ProjectClient`; 5-minute in-process cache |

**Example response**

```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "ProjectID": "12",
        "ProjectClient": "Acme",
        "ProjectName": "Portal",
        "ProjectCode": "ACM-PORTAL"
      }
    ],
    "clients": ["*New", "Acme"]
  }
}
```

---

### GET `/api/master/tasks`

| Field | Value |
|-------|--------|
| HTTP Method | GET |
| URL | `/api/master/tasks` |
| Controller | `src/app/api/master/tasks/route.ts` → `GET` |
| Service | `getCachedTasks()` → Sheets `Roles and Tasks!A2:B` |
| Request DTO | none |
| Response DTO | `ApiResponse<Task[]>` (`{ TaskID, Task }`) |
| Authentication | Session |
| Permission | Full catalog for all authenticated users |
| Validation | none beyond auth |
| Business Rules | Flat task list; not filtered by project |

---

### GET `/api/staff/profile`

| Field | Value |
|-------|--------|
| HTTP Method | GET |
| URL | `/api/staff/profile` |
| Controller | `src/app/api/staff/profile/route.ts` → `GET` |
| Service | Session only (no Zoho call on this request) |
| Request DTO | none |
| Response DTO | `ApiResponse<StaffProfile>` |
| Authentication | Session |
| Permission | Own profile from JWT |
| Validation | 404 if `staffProfile` missing |

**Example response**

```json
{
  "success": true,
  "data": {
    "EmployeeID": "S0005",
    "FirstName": "Ada",
    "LastName": "Lovelace",
    "Nickname": "Ada",
    "Email": "ada@shopstack.asia",
    "Position": "Engineer",
    "Location": "Bangkok"
  }
}
```

---

### GET `/api/staff/leave`

| Field | Value |
|-------|--------|
| HTTP Method | GET |
| URL | `/api/staff/leave` |
| Controller | `src/app/api/staff/leave/route.ts` → `GET` |
| Service | Redis cache + `ZohoPeopleService.fetchLeaveRecords` + `normalizeZohoLeaveRecords` |
| Request DTO | Query: `from?`, `to?` (default ±3 months from today) |
| Response DTO | `ApiResponse<LeaveDayEntry[]>` |
| Authentication | Session + `EmployeeID` required |
| Permission | Own EmployeeID only |
| Validation | 404 without EmployeeID |
| Business Rules | Cache key `leave:{id}:{from}:{to}` TTL 21600s; **does not filter by ApprovalStatus** |

---

### GET `/api/staff/leave/monthly`

| Field | Value |
|-------|--------|
| HTTP Method | GET |
| URL | `/api/staff/leave/monthly` |
| Controller | `src/app/api/staff/leave/monthly/route.ts` → `GET` |
| Service | Same as leave (Zoho + Redis + normalize) |
| Request DTO | Query: `year?`, `month?` (month 1–12) |
| Response DTO | `ApiResponse<LeaveDayEntry[]>` |
| Authentication | Session + EmployeeID |
| Permission | Own leave |
| Validation | Invalid year/month → 400 |
| Notes | **This is the leave API used by the timesheet UI** |

---

### GET `/api/staff/leave/yearly`

| Field | Value |
|-------|--------|
| HTTP Method | GET |
| URL | `/api/staff/leave/yearly` |
| Controller | `src/app/api/staff/leave/yearly/route.ts` → `GET` |
| Service | Same leave stack |
| Request DTO | Query: `year?` |
| Response DTO | `ApiResponse<LeaveDayEntry[]>` |
| Authentication | Session + EmployeeID |
| Permission | Own leave |

---

## Submit APIs

### POST `/api/timesheet/submit`

| Field | Value |
|-------|--------|
| HTTP Method | POST |
| URL | `/api/timesheet/submit` |
| Controller | `src/app/api/timesheet/submit/route.ts` → `POST` |
| Service | `getCachedProjects` / `getCachedTasks`; `withTimeLogWriteLock`; `GoogleSheetsService` delete/upsert/`createProject` |
| Request DTO (Zod) | `{ date: YYYY-MM-DD; entries: { projectId: string; taskId: string; hours: number }[] }` |
| Response DTO | `ApiResponse<void>` (`{ success: true }` on success) |
| Authentication | Session + `staffProfile` |
| Permission | Writes **only** as session EmployeeID / name / position |
| Validation | Zod: date regex; projectId/taskId min 1; hours 0–24; every `taskId` must exist in master tasks |
| Business Rules | Empty `entries` deletes all rows for date+staff; unknown `projectId` treated as custom name → `createProject`; existing rows with Project\|Task not in payload deleted; upsert by Date+Staff+Project+Task (Time Log ID hash); Redis lock key `timesheet:sheets:timelog:write` |

**Example request**

```http
POST /api/timesheet/submit
Content-Type: application/json

{
  "date": "2026-07-14",
  "entries": [
    { "projectId": "12", "taskId": "3", "hours": 4 },
    { "projectId": "My New Job", "taskId": "3", "hours": 2 }
  ]
}
```

**Example success**

```json
{ "success": true }
```

**Example errors**

```json
{ "success": false, "error": "Unauthorized" }
```
```json
{ "success": false, "error": "Invalid task ID: 999" }
```
```json
{ "success": false, "error": "Timesheet is busy, please try again" }
```
(HTTP 503 for lock timeout / Redis unavailable)

---

## Create / Update / Delete APIs (entry-level)

**Not found** as separate endpoints.

| Desired operation | How it maps today |
|-------------------|-------------------|
| Create entry | Include entry in day’s `entries` on submit → append or upsert |
| Update entry | Same Project+Task key on same date → upsert hours |
| Delete entry | Omit that Project\|Task from day’s `entries` on submit |
| Delete all for day | `POST` with `"entries": []` |

Side-effect create (not a timesheet entry API):

| Operation | When |
|-----------|------|
| Create Project row | Submit with `projectId` not in Projects map → `GoogleSheetsService.createProject` |

---

## Approval APIs

**None found** (no approve/reject/recall routes, handlers, or types).

---

## Reporting APIs

**None found** (no report/export/aggregate routes).

---

## Ancillary (related but not timesheet CRUD)

### Auth

| Method | URL | Auth | Role |
|--------|-----|------|------|
| GET/POST | `/api/auth/[...nextauth]` | NextAuth | Google SSO; domain + Zoho gate in `src/lib/auth.ts` |

### Cron (Bearer `CRON_SECRET`)

| Method | URL | Service | Purpose |
|--------|-----|---------|---------|
| POST/GET | `/api/cron/friday-reminder` | Zoho employees, SMTP, Slack, `refreshHolidayCache` | Blast reminder |
| POST/GET | `/api/cron/refresh-holidays` | `refreshHolidayCache` | Fill Redis holiday keys |

### Debug (**no authentication in code**)

| Method | URL | Purpose |
|--------|-----|---------|
| GET/POST | `/api/debug/email-test` | SMTP probe |
| GET/POST | `/api/debug/slack-test` | Slack probe |
| GET | `/api/debug/zoho-test` | Employee by email |
| GET | `/api/debug/zoho-token-test` | Token refresh smoke |

These are **not** suitable as AI agent tools against production without auth changes (finding only; no implementation proposed here).

---

## Inventory table (timesheet product surface)

| Method | Endpoint | Category |
|--------|----------|----------|
| GET | `/api/timesheet/get` | Read |
| POST | `/api/timesheet/submit` | Submit (also create/update/delete day rows) |
| GET | `/api/timesheet/holidays` | Read |
| GET | `/api/master/projects` | Read |
| GET | `/api/master/tasks` | Read |
| GET | `/api/staff/profile` | Read |
| GET | `/api/staff/leave` | Read |
| GET | `/api/staff/leave/monthly` | Read |
| GET | `/api/staff/leave/yearly` | Read |
| — | Approval / Reporting / Search | **Not present** |

# 07 — MCP Tool Candidates

**Rule:** Only map tools to **existing** backend capabilities. Do not invent endpoints.  
These tool names are **candidates** — they do not exist as MCP tools in the repo today.

---

## Read tools (directly mappable)

| Candidate tool | Maps to | Notes |
|----------------|---------|-------|
| `get_current_employee` | `GET /api/staff/profile` | Session-scoped |
| `get_weekly_timesheet` | `GET /api/timesheet/get?weekStart=` | Requires `weekStart` |
| `list_projects` | `GET /api/master/projects` | Full list; no server search |
| `list_tasks` | `GET /api/master/tasks` | Full list; no server search |
| `get_leave_monthly` | `GET /api/staff/leave/monthly?year=&month=` | UI’s leave source |
| `get_leave_range` | `GET /api/staff/leave?from=&to=` | Exists; UI does not use |
| `get_leave_yearly` | `GET /api/staff/leave/yearly?year=` | Exists; UI does not use |
| `get_holidays` | `GET /api/timesheet/holidays?year=` | Redis cache dependent |

### Explicitly not listed as search tools

There is **no** `GET .../search` for projects or tasks. A tool named `search_projects` would **invent** capability unless implemented as client-side filter over `list_projects` (adapter, not a new backend).

---

## Write tools (mappable with semantic caution)

| Candidate tool | Maps to | Actual semantics |
|----------------|---------|------------------|
| `submit_day_timesheet` | `POST /api/timesheet/submit` | Replace day’s entries for session user |
| `clear_day_timesheet` | `POST /api/timesheet/submit` with `"entries": []` | Deletes all rows that day |
| `create_custom_project_via_submit` | Same POST with unknown `projectId` string | Side effect of submit — not a standalone API |

### Names that would misrepresent the API

| Misleading name | Why not (as a direct map) |
|-----------------|---------------------------|
| `create_time_entry` | No entry-create endpoint; day replace only |
| `update_time_entry` | No entry-update endpoint |
| `delete_time_entry` | No entry-delete endpoint |
| `save_draft` | No draft API |
| `submit_week` | No single week endpoint — N × `submit_day_timesheet` |
| `approve_timesheet` | No API |
| `reject_timesheet` | No API |
| `recall_submission` | No API |
| `get_report` / `export_timesheet` | No API |
| `copy_previous_day` | No API (client-only) |
| `copy_previous_week` | No API |

If an adapter tool `submit_week` is offered later, it must be documented as **orchestration** of existing `POST /api/timesheet/submit`, not a backend feature.

---

## System tools (exist but not employee timesheet MCP)

| Candidate | Maps to | Caveat |
|-----------|---------|--------|
| `trigger_friday_reminder` | `POST /api/cron/friday-reminder` | Requires `CRON_SECRET`; blasts all employees |
| `refresh_holiday_cache` | `POST /api/cron/refresh-holidays` | Requires `CRON_SECRET` |

Debug routes (`/api/debug/*`) exist but are **unauthenticated** — not listed as safe tool candidates.

---

## Mapping diagram

```text
get_current_employee     →  GET  /api/staff/profile
list_projects            →  GET  /api/master/projects
list_tasks               →  GET  /api/master/tasks
get_weekly_timesheet     →  GET  /api/timesheet/get
get_holidays             →  GET  /api/timesheet/holidays
get_leave_monthly        →  GET  /api/staff/leave/monthly
submit_day_timesheet     →  POST /api/timesheet/submit
clear_day_timesheet      →  POST /api/timesheet/submit  { entries: [] }
```

---

## Auth dependency for all employee tools

Every timesheet/master/staff tool above requires a **NextAuth session** for the target employee (middleware + `getServerSession`).  
There is **no** service-account or Slack-user→EmployeeID API in this codebase for tool invocation.

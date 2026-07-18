# 02 — Business Operations

**Source of truth:** `src/components/*`, `src/app/api/timesheet/*`, `src/lib/*`  
Operations marked **Client-only** have no dedicated API. Operations marked **Not found** do not exist in code.

---

## Operation inventory

| Operation | Status | Layer |
|-----------|--------|-------|
| Create Time Entry (draft) | Exists | Client-only |
| Edit Time Entry (draft) | Exists | Client-only |
| Delete Time Entry (draft) | Exists | Client-only |
| Persist / replace day entries | Exists | API submit |
| Submit Week | Exists | Client orchestration + API submit × N |
| Draft Save (server) | **Not found** | — |
| Recall Submission | **Not found** | — |
| Approve | **Not found** | — |
| Reject | **Not found** | — |
| Copy Previous Day | Exists | Client-only |
| Copy Previous Week | **Not found** | — |
| Load week timesheet | Exists | API get |
| Load projects / tasks | Exists | API master |
| Load leave / holidays | Exists | API leave / holidays |
| Create custom project | Exists | Side effect of submit |
| Clear day on server | Exists (API) | `entries: []`; **UI week submit does not call this for empty days** |

---

## OP-01 Create Time Entry (draft)

| Aspect | Detail |
|--------|--------|
| Required data | None to create empty row; to be valid later: client (UI), projectId, taskId, hours > 0 |
| Validation | Touched-field UI only until submit |
| Side effects | React state only |
| Permission | Signed-in user editing own week UI |
| APIs involved | **None** |
| Code | `WeeklyTimesheet.handleAddEntry`, `TimeEntryForm` |

---

## OP-02 Edit Time Entry (draft)

| Aspect | Detail |
|--------|--------|
| Required data | Partial `TimeEntry` updates |
| Validation | UI; disabled when full leave |
| Side effects | Recalculate day `totalHours` |
| Permission | Own UI |
| APIs involved | **None** |
| Code | `handleUpdateEntry` |

---

## OP-03 Delete Time Entry (draft)

| Aspect | Detail |
|--------|--------|
| Required data | dayIndex, entryIndex |
| Validation | Disabled on full leave |
| Side effects | State remove + totalHours |
| Permission | Own UI |
| APIs involved | **None** until later submit |
| Code | `handleDeleteEntry` |

**Important:** Deleting in UI does **not** remove Sheets rows until a submit for that day is issued with the key omitted. If the day becomes empty, **Submit Week skips the day** (`submitWeekDaysSequentially` filters `entries.length > 0`), so Sheets rows can remain.

---

## OP-04 Persist day / replace day (server write)

| Aspect | Detail |
|--------|--------|
| Required data | `date`, `entries[]` with `projectId`, `taskId`, `hours` |
| Validation | Zod; task must exist; hours 0–24; session staffProfile |
| Side effects | Redis write lock; delete removed keys; optional `createProject`; upsert Time Log rows |
| Permission | Session employee only (staff fields from session) |
| APIs involved | `POST /api/timesheet/submit` |
| Code | `src/app/api/timesheet/submit/route.ts` |

This is the **only** write API for time entries.

---

## OP-05 Submit Week

| Aspect | Detail |
|--------|--------|
| Required data | At least one day with entries; each entry projectId, taskId, hours > 0 (client) |
| Validation | Client alerts for incomplete fields; then per-day server Zod |
| Side effects | Sequential POSTs; on full success reload `GET /api/timesheet/get`; browser alerts |
| Permission | Own session |
| APIs involved | `POST /api/timesheet/submit` (one call per day with entries); then `GET /api/timesheet/get` |
| Code | `WeeklyTimesheet.handleSubmitWeek`, `submitWeekDaysSequentially` |

“Submit” means **write to Google Sheets**, not submit-for-approval.

---

## OP-06 Draft Save (server)

**Not found.** No draft endpoint, no draft sheet status, no autosave API.

---

## OP-07 Recall Submission

**Not found.** No recall API or status. Overwrite/delete via new submit is the only reversal path.

---

## OP-08 Approve / OP-09 Reject

**Not found.** No approver role, inbox, comments, or status transitions.

---

## OP-10 Copy Previous Day

| Aspect | Detail |
|--------|--------|
| Required data | Previous day entries in client state |
| Validation | `dayIndex > 0`; current day `entries.length === 0`; not full leave; not submitting |
| Side effects | Appends clones with new UI ids; **not** persisted until Submit Week |
| Permission | Own UI |
| APIs involved | **None** |
| Code | `handleCopyYesterday`, `DailyCard` button |

---

## OP-11 Copy Previous Week

**Not found** in UI or API.

---

## OP-12 Load week timesheet

| Aspect | Detail |
|--------|--------|
| Required data | `weekStart` (Monday ISO date) |
| Validation | weekStart required server-side |
| Side effects | None (read) |
| Permission | Own Staff ID filter |
| APIs involved | `GET /api/timesheet/get` |
| Code | `WeeklyTimesheet` load effect |

---

## OP-13 Load master data

| Aspect | Detail |
|--------|--------|
| Required data | Session |
| Validation | Auth only |
| Side effects | May populate 5-min memory cache |
| Permission | Any authenticated user — full lists |
| APIs involved | `GET /api/master/projects`, `GET /api/master/tasks` |

---

## OP-14 Load leave / holidays (context)

| Aspect | Detail |
|--------|--------|
| Required data | Leave: year/month or range; Holidays: year; location from profile/env |
| Validation | Leave needs EmployeeID; holiday year ≥ 2000 |
| Side effects | May populate Redis leave cache; holidays read-only from Redis |
| Permission | Own leave; holidays by location |
| APIs involved | `/api/staff/leave/monthly` (UI), optional other leave routes; `/api/timesheet/holidays` |
| Business effect on editing | Full leave disables UI edit; holiday does **not**; **neither enforced on submit API** |

---

## OP-15 Create custom project

| Aspect | Detail |
|--------|--------|
| Required data | Free-text name in `projectId` when not matching ProjectID |
| Validation | Non-empty string; typically UI requires client `*New` |
| Side effects | Append Projects sheet row: next numeric ID, client `*New`, code `NEW-{name}`; clear projects cache |
| Permission | Any employee who can submit |
| APIs involved | Embedded in `POST /api/timesheet/submit` via `createProject` |

---

## OP-16 Friday reminder (system)

| Aspect | Detail |
|--------|--------|
| Required data | `Authorization: Bearer ${CRON_SECRET}` |
| Validation | Bearer match |
| Side effects | Optional holiday refresh; email all `@shopstack.asia` employees; Slack channel post |
| Permission | Cron secret |
| APIs involved | `POST/GET /api/cron/friday-reminder` |

Not an employee self-service operation; does not inspect incomplete timesheets.

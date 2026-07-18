# 05 — Required Information (per operation)

For each operation: Mandatory / Optional / Auto-generated / Defaults / what AI must ask if acting for a user.  
Based only on UI + API code.

---

## Persist day — `POST /api/timesheet/submit`

| Class | Fields |
|-------|--------|
| **Mandatory (body)** | `date` (YYYY-MM-DD); for each entry: `projectId` (min 1), `taskId` (min 1), `hours` (number 0–24) |
| **Mandatory (auth)** | Valid session with `staffProfile` |
| **Optional** | Empty `entries` array (means delete all for day) |
| **Auto-generated** | Time Log ID (SHA-256 prefix of date\|staff\|project\|task); staff name/position from session; project client/name/code from Projects sheet (or createProject); task name from Tasks sheet |
| **Defaults** | None for hours/project/task in API |
| **Not in API** | Client label, description, billable, start/end time, comments |

### What AI must ask the user (if not already known)

| Need | Why |
|------|-----|
| Date | Required; no “today” default in API |
| Project | Must be ProjectID or intentional new name |
| Task | Must be TaskID from master list |
| Hours | Required per entry |
| Full day entry set | Because submit **replaces** the day’s Project\|Task set — AI must know whether to merge with existing or replace |

### What AI should resolve without asking (from APIs/session)

| Field | Source |
|-------|--------|
| Staff ID / name / position | Session / profile API |
| Project metadata | Projects list after ID known |
| Task name | Tasks list after ID known |

---

## Submit Week (UI orchestration)

| Class | Fields |
|-------|--------|
| **Mandatory** | ≥1 entry in week; each entry projectId, taskId, hours **> 0** (stricter than API) |
| **Optional** | Which days to include (UI sends only days with entries) |
| **Auto-generated** | Same as per-day submit |
| **Defaults** | Week from UI navigation (Monday start) |
| **AI must ask / confirm** | Which week; complete entry set per day; confirmation before multi-day writes |

---

## Create / Edit / Delete draft entry (client-only)

| Class | Fields |
|-------|--------|
| **Mandatory (to pass UI submit)** | Client (UI-only), Project, Task, Hours > 0 |
| **Optional** | Multiple entries per day |
| **Auto-generated** | Temporary UI `id` (`Date.now()` etc.) |
| **Defaults** | hours `0`, empty ids until filled |
| **Server draft** | N/A — not persisted |

**AI must ask:** same as persist, plus whether user wants client `*New` + custom project name.

---

## Copy Previous Day (client-only)

| Class | Fields |
|-------|--------|
| **Mandatory** | Previous day has entries; target day empty; not Monday; not full leave |
| **Optional** | — |
| **Auto-generated** | New UI ids for copies |
| **Defaults** | Copies projectId, taskId, hours as-is |
| **AI must ask** | Target date; confirm overwrite policy (UI only allows empty target) |

---

## Load week — `GET /api/timesheet/get`

| Class | Fields |
|-------|--------|
| **Mandatory** | `weekStart` query |
| **Optional** | — |
| **Auto-generated** | Entry ids from Time Log ID |
| **Defaults** | — |
| **AI must ask** | Which week (or derive Monday from a date) |

---

## List projects / tasks

| Class | Fields |
|-------|--------|
| **Mandatory** | Session cookie |
| **Optional** | — |
| **Auto-generated** | — |
| **Defaults** | Full catalog |
| **AI must ask** | How to disambiguate if multiple projects match a spoken name (no search API — agent-side filter only) |

---

## Get leave

| Class | Fields |
|-------|--------|
| **Mandatory** | Session + EmployeeID |
| **Optional** | `from`/`to` or `year`/`month` depending on route |
| **Defaults** | leave route: ±3 months; monthly: current year/month if omitted |
| **AI must ask** | Period of interest if not current month |

---

## Get holidays

| Class | Fields |
|-------|--------|
| **Mandatory** | Session |
| **Optional** | `year` (defaults to current year) |
| **Auto-generated** | Location from profile or env |
| **AI must ask** | Year if not current; cannot set arbitrary location via query (derived server-side) |

---

## Get profile

| Class | Fields |
|-------|--------|
| **Mandatory** | Session |
| **Optional** | — |
| **Defaults** | — |
| **AI must ask** | Nothing if acting as the signed-in user |

---

## Create custom project (via submit)

| Class | Fields |
|-------|--------|
| **Mandatory** | Non-matching `projectId` string used as name; valid `taskId`; `hours`; `date` |
| **Auto-generated** | New ProjectID, `ProjectClient='*New'`, `ProjectCode=NEW-{name}` |
| **AI must ask** | Exact project name; confirm creation (irreversible sheet append from this app’s perspective) |

---

## Operations with no required-information profile (not in code)

Approve, Reject, Recall, Draft Save, Copy Previous Week, Reporting — **not implemented**; no field contracts exist.

---

## Example card: Create Time Entry (as mapped to backend)

There is no create-entry endpoint. Mapped to day submit:

**Required**

- Date  
- Project (`ProjectID` or new name)  
- Task (`TaskID`)  
- Hours  
- Awareness of other entries same day (replace semantics)

**Optional**

- None in API (no description field exists)

**Default**

- Current user (session)  
- Project/task metadata from master data after IDs resolved  

**Missing information AI must ask**

- Date, project, task, hours  
- Whether to merge with existing day rows or replace  
- If project name is ambiguous among list results  
- If user intends `*New` custom project vs existing ID  

**Description:** field **does not exist** — do not invent as optional backend field.

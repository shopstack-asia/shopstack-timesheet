# 06 — Resolution Strategy

**Rules:** Never invent IDs. Never auto-create projects without confirmation.  
No search APIs — filter `list_projects` / `list_tasks` results agent-side (`docs/ai-discovery/04`).

---

## Project resolution

### Inputs

User utterances: client name, project name, code, or ID.

### Procedure

```text
1. Call list_projects() → { projects, clients }
2. Normalize query (trim, case-fold)
3. Match candidates where ANY of:
   - ProjectID exact
   - ProjectCode exact or contains
   - ProjectName exact or contains
   - ProjectClient exact or contains (then narrow)
4. Scoring (suggested):
   exact ID > exact code > exact name > unique contains name > client+name
5. If 0 matches → Unknown Project flow (do not submit string)
6. If 1 high-confidence match → propose to user (“Use Portal (ACM-PORTAL) [12]?”)
   Optional auto-accept only if exact ID or exact code unique — still show in confirmation before write
7. If 2+ matches → Ambiguous Project: numbered list, wait for choice
```

### Examples

| User says | Behavior |
|-----------|----------|
| `"12"` | Exact ProjectID if exists |
| `"Hertz"` | All projects with Client/Name/Code containing Hertz → list |
| `"Hertz Thailand"` | Prefer client match then name |
| `"Hertz Website"` | Prefer name/code contains Website under Hertz client |
| `"Portal"` | Likely many → disambiguate with Client + Code |

### Custom create

Only if user explicitly says create/new project AND confirms FLOW-10.  
Then `projectId` submitted = **exact agreed name string**, not a guessed ID.

---

## Task resolution

```text
1. list_tasks()
2. Match TaskID exact OR Task name exact/contains
3. 0 matches → cannot create tasks (no API) → show options
4. 2+ → numbered list
5. Never send free-text task name as taskId (API returns Invalid task ID)
```

| User says | Behavior |
|-----------|----------|
| `"Development"` | Filter Task names; if many Dev* → ask |
| `"3"` | Exact TaskID if exists |

**Note:** Backend allows any TaskID with any Project — no project-scoped tasks.

---

## Client resolution

```text
Client is not a submit field.
Use clients[] from list_projects to:
  - filter projects when user names a client
  - detect "*New" for custom project UX (mirrors TimeEntryForm)
```

If user says only a client with no project → ask which project under that client.

---

## Date resolution

App weeks are **Monday–Sunday** (`weekStartsOn: 1`).

| Phrase | Resolution rule |
|--------|-----------------|
| `today` | Local date of user timezone **must be defined by deployment** (browser uses local Date; Slack must pick a TZ policy — **not in timesheet backend**) |
| `yesterday` | today − 1 calendar day |
| `tomorrow` / future weekday | Resolve then **warn** (backend allows) |
| `this Monday` | Monday of current week (weekStartsOn 1) |
| `last Friday` | Friday of previous week |
| `last week` | Ambiguous → ask which day or show whole week |
| Absolute `2026-07-14` / `14 Jul` | Parse to YYYY-MM-DD; reject invalid calendar dates even if regex-like |

For `get_weekly_timesheet`, compute:

```text
weekStart = Monday on or before the target date
```

(Same as `startOfWeek(date, { weekStartsOn: 1 })` in app.)

**Timezone:** Backend has no TZ config. Spec requirement for Slack agent: declare TZ (e.g. Asia/Bangkok) in agent config — this is **orchestration config**, not a Timesheet API.

---

## Leave / holiday resolution

| Check | Tool | Interpretation |
|-------|------|----------------|
| Leave | `get_leave_monthly` | `type===FULL` → treat as leave day (UI blocks); show `status` as returned |
| Holiday | `get_holidays` | Match `date`; `is_holiday` or presence |

Do not invent leave/holiday from calendar knowledge — use APIs (holidays require warm Redis cache).

---

## User resolution

Only session employee. Slack mapping **does not exist** in codebase — agent host must supply authenticated session equivalent before tools run (`docs/ai-discovery/08`).

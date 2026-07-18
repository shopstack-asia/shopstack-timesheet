# 05 — Merge Strategy

## Backend fact

```text
POST /api/timesheet/submit
= Replace the Time Log rows for (date, session EmployeeID)
  with exactly the ProjectID|TaskID keys in `entries`
```

Evidence: `src/app/api/timesheet/submit/route.ts` — delete keys not in submission; upsert remaining.  
Identity key: `Project ID|Task ID` (custom name resolved to new ProjectID before write).

**There is no create-entry / patch-entry / delete-entry API.**

---

## Why AI cannot directly call submit with a single new entry

If the day already has entries `[A, B]` and the agent posts only `[C]`:

- A deleted  
- B deleted  
- C upserted  

That is data loss. Direct single-entry POST is **unsafe**.

---

## Canonical day model (agent-local)

```text
DaySet = Map<string /* projectId|taskId */, { projectId, taskId, hours }>
```

Load from `get_weekly_timesheet` → for `date`, build DaySet from entries (use stored `projectId` / `taskId` as returned — already ProjectIDs from Sheets).

---

## Algorithms

### Add Entry

```text
function merge_add(daySet, entry):
  key = entry.projectId + "|" + entry.taskId
  if daySet.has(key):
    # Duplicate Project+Task — backend would upsert to one row
    # Policy: SUM hours (or REPLACE — must ask user if both intents possible)
    default policy: ask "Line exists with Xh. Add Yh (total X+Y) or replace with Yh?"
  else:
    daySet.set(key, entry)
  return daySet
```

### Update Entry

```text
function merge_update(daySet, projectId, taskId, hours):
  key = projectId + "|" + taskId
  if !daySet.has(key):
    return { error: "NOT_FOUND" }  # offer add
  daySet.set(key, { projectId, taskId, hours })
  return daySet
```

### Delete Entry

```text
function merge_delete(daySet, projectId, taskId):
  key = projectId + "|" + taskId
  if !daySet.has(key): return { error: "NOT_FOUND" }
  daySet.delete(key)
  return daySet
```

### Delete All / Empty Day

```text
function merge_clear():
  return empty DaySet

# Persist empty day:
clear_day_timesheet(date)  # entries: []
# Do NOT omit the submit call — skipping submit leaves old Sheets rows
# (UI Submit Week skips empty days — agent must not copy that bug for clear intent)
```

### Duplicate Project+Task

Backend stores **one** row per key. Agent must not send two array elements with same projectId+taskId (last wins ambiguously). Normalize to one map entry before submit.

### Conflict (stale read)

```text
1. get_weekly_timesheet at start of write flow
2. merge in memory
3. confirm
4. submit
5. If 503: retry get → re-merge from fresh → re-confirm if set changed → submit
6. After success: get again; if mismatch, report conflict to user
```

Redis lock serializes writers but does not merge semantic conflicts between two agents.

### Empty Day after delete

If `daySet` empty and user intent was delete-last-entry → confirm clear → `clear_day_timesheet`.  
If user intent was “remove one line” and others remain → `submit_day_timesheet` with remaining only.

---

## Payload builder

```text
entries = Array.from(daySet.values()).map(({ projectId, taskId, hours }) => ({
  projectId,  // must be ProjectID string OR confirmed custom name
  taskId,     // must be TaskID
  hours       // number; agent policy hours > 0
}))
POST body: { date, entries }
```

Drop UI-only fields (`id`, client).

---

## Custom project interaction with merge

Before submit, if `projectId` is a new name:

- Confirmation required (Projects sheet mutation)
- After success, subsequent merges should use **numeric ProjectID** from refreshed `list_projects` / get week reload (returned entries use Project ID from Sheets)

---

## Test cases for agent implementers

| Case | Expected merge → submit |
|------|-------------------------|
| Empty day + add A | entries=[A] |
| Day [A,B] + add C | entries=[A,B,C] |
| Day [A,B] + update A hours | entries=[A',B] |
| Day [A,B] + delete A | entries=[B] |
| Day [A] + delete A | clear_day / entries=[] |
| Day [A] + add A again | ask sum vs replace |
| Accidental entries=[new] only | **Forbidden** without merge |

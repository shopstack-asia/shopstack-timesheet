# 04 — Tool Orchestration

**MCP tools only** from `docs/ai-discovery/07_mcp_tool_candidates.md`.  
Steps marked **(agent-local)** are not MCP tools and must not be exposed as fake backend APIs.

---

## Why AI must not “just” call `submit_day_timesheet`

See also [05_merge_strategy.md](./05_merge_strategy.md). Short form:

1. Payload replaces the **entire** day’s Project\|Task set.
2. Omitting an existing key **deletes** that Sheets row.
3. Unknown `projectId` **creates** a Projects sheet row.
4. No server leave/holiday check.
5. UI validates hours > 0; API allows 0.

Therefore every write sequence **must** read current day → merge → confirm → submit full set.

---

## SEQ-A — Add entry (INT-001 / INT-002)

```text
1. list_projects()
   Why: Resolve user text → ProjectID; detect *New create path; never invent IDs.
2. list_tasks()
   Why: Resolve → TaskID; unknown tasks fail 400 on submit.
3. (agent-local) resolve_date → weekStart Monday
4. get_weekly_timesheet(weekStart)
   Why: Load existing entries for merge; slice target date.
5. (agent-local) resolve_project / resolve_task (or clarify)
6. (optional) get_leave_monthly + get_holidays
   Why: Guardrails mirroring UI leave block / holiday warn (not enforced by API).
7. (agent-local) merge_add(existing, newEntry)
   Why: Preserve sibling rows.
8. (agent-local) validate_day (hours>0, entry hours≤24, warn sum>24)
9. (agent-local) confirm with user
10. submit_day_timesheet({ date, entries: merged })
    Why: Only write API.
11. (optional) get_weekly_timesheet again
    Why: Verify; matches UI reload after submit.
```

---

## SEQ-B — Update hours (INT-003)

```text
1–5. Same as SEQ-A through resolve
6. (agent-local) merge_update: set hours on ProjectID|TaskID key; if missing → offer add
7. confirm (show old → new)
8. submit_day_timesheet(merged)
```

---

## SEQ-C — Delete entry (INT-004)

```text
1. get_weekly_timesheet(weekStart)  # lists optional if names need resolve
2. (agent-local) identify key; merge_delete
3. If remaining.length === 0 → switch to SEQ-D confirmation path (clear)
4. Else confirm remaining table
5. submit_day_timesheet({ date, entries: remaining })
```

---

## SEQ-D — Clear day (INT-005)

```text
1. get_weekly_timesheet — show doomed entries
2. confirm clear
3. clear_day_timesheet({ date })
   Equivalent API: POST submit { date, entries: [] }
```

---

## SEQ-E — Show week / day (INT-006–008)

```text
1. (agent-local) resolve weekStart
2. get_weekly_timesheet(weekStart)
3. (optional) list_projects + list_tasks — decorate IDs with names
4. Present table (no write)
```

---

## SEQ-F — List projects / tasks (INT-011–012)

```text
1. list_projects() OR list_tasks()
2. (agent-local) filter/sort for display
```

---

## SEQ-G — Holidays / leave (INT-009–010)

```text
Holidays:
  1. get_holidays(year)
  2. filter by month/week client-side

Leave:
  1. get_leave_monthly(year, month)  # primary; matches UI
  2. For spans across months: call twice and union
```

---

## SEQ-H — Custom project (INT-013)

```text
1. list_projects() — warn on similar names; ensure user wants CREATE not match
2. list_tasks() — resolve TaskID
3. get_weekly_timesheet — merge
4. confirm CREATE + entry
5. submit_day_timesheet with projectId = exact new name string
   Why: Backend createProject only when projectId ∉ projectMap
6. list_projects() again (may be stale up to 5 min cache — tell user if ID not visible yet)
```

---

## SEQ-I — Copy previous day (INT-024)

```text
1. get_weekly_timesheet for source week (and target week if different)
2. (agent-local) copy entries; if target non-empty → confirm merge vs replace
3. confirm
4. submit_day_timesheet(targetDate, entries)
```

---

## SEQ-J — Multi-day / “submit week” (INT-025)

```text
1. get_weekly_timesheet — establish baseline
2. For each day with intended entries:
     build merged set (from memory or user payload)
3. confirm ALL days as one summary
4. For each day in order:
     submit_day_timesheet(day)
     On failure: stop or continue? Spec: continue like UI submitWeekDaysSequentially,
     then report which dates failed (matches client behavior)
5. Final get_weekly_timesheet
Note: Empty days are NOT submitted — clearing requires SEQ-D per day
```

---

## SEQ-K — Profile (INT-014)

```text
1. get_current_employee()
```

---

## Parallelism

| Safe in parallel | Not safe |
|------------------|----------|
| `list_projects` + `list_tasks` + `get_holidays` | Two writes same day without lock awareness |
| leave + holidays + week get (reads) | `submit_day_timesheet` overlapping same employee day — rely on Redis lock; still avoid parallel submits from agent |

Prefer **sequential writes**. Parallel reads OK.

---

## Tool input/output contracts (from APIs)

| Tool | Key inputs | Key outputs |
|------|------------|-------------|
| `get_weekly_timesheet` | `weekStart` YYYY-MM-DD | `Record<date, {id, projectId, taskId, hours}[]>` |
| `submit_day_timesheet` | `date`, `entries[{projectId,taskId,hours}]` | `{ success }` |
| `clear_day_timesheet` | `date` | `{ success }` |
| `list_projects` | — | `{ projects[], clients[] }` |
| `list_tasks` | — | `Task[]` |
| `get_leave_monthly` | `year`, `month` 1–12 | `LeaveDayEntry[]` |
| `get_holidays` | `year?` | `Holiday[]` |
| `get_current_employee` | — | `StaffProfile` |

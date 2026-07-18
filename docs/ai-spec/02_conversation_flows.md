# 02 — Conversation Flows

Each flow uses only discovery MCP tools + agent-local steps.  
Template stages: User → AI Understanding → Missing Information → Tool Calls → Confirmation → Execution → Success / Failure.

---

## FLOW-01 Create Time Entry

```text
User: "Log 4 hours on Hertz portal for development yesterday"

AI Understanding: INT-001; date=yesterday; project~Hertz portal; task~development; hours=4

Missing Information:
  - Resolve absolute date
  - Resolve ProjectID (may be ambiguous)
  - Resolve TaskID (may be ambiguous)

Tool Calls (read):
  1. get_current_employee()                    # optional identity check
  2. list_projects()                           # required for resolution
  3. list_tasks()                              # required for resolution
  4. get_weekly_timesheet(weekStart=Monday)    # required for merge

Agent-local:
  - resolve_date("yesterday")
  - resolve_project("Hertz portal") → ProjectID or clarify
  - resolve_task("development") → TaskID or clarify
  - merge_add(existingDay, {projectId, taskId, hours:4})
  - if day total > 24 → ask to reduce (guardrail; backend allows per-entry ≤24 only)

Confirmation (required):
  Show date, before→after entry table, day total, Project Name/Code, Task name, hours

Execution:
  submit_day_timesheet({ date, entries: mergedFullDay })

Success:
  "Saved. {date}: … totals …"
  Optional: get_weekly_timesheet again to verify

Failure:
  See 10_error_recovery.md (400/401/503/custom project mishap)
```

---

## FLOW-02 Update Time Entry

```text
User: "Change yesterday Hertz development to 6 hours"

AI Understanding: INT-003; update hours for matching Project|Task

Missing: date, project, task if ambiguous

Tool Calls: list_projects, list_tasks, get_weekly_timesheet

Agent-local: resolve → find key in day → merge_update hours
  If key missing → treat as create (INT-001) after telling user no existing line

Confirmation: Yes — show old hours → new hours

Execution: submit_day_timesheet(full merged day)

Success / Failure: same pattern as FLOW-01
```

---

## FLOW-03 Delete Time Entry

```text
User: "Remove the Hertz development line from yesterday"

AI Understanding: INT-004

Tool Calls: get_weekly_timesheet (+ lists if needed to resolve names)

Agent-local: merge_delete Project|Task key from day set
  If day becomes empty → DO NOT auto-call clear unless user asked clear;
  empty merged set → use clear_day_timesheet only after clear confirmation (INT-005)

Confirmation: Yes — name the line being removed; show remaining lines

Execution: submit_day_timesheet({ date, entries: remaining }) 
  OR clear_day_timesheet if remaining empty and confirmed as clear

Success: list remaining entries or “day empty”
```

---

## FLOW-04 Clear Day

```text
User: "Clear my timesheet for Friday"

AI Understanding: INT-005

Tool Calls: get_weekly_timesheet (show what will be deleted)

Confirmation: Critical — “This deletes ALL entries for {date}. Reply YES to clear.”

Execution: clear_day_timesheet({ date })  # POST entries: []

Success: “Cleared {date}.”
Failure: 503 lock → retry guidance
```

---

## FLOW-05 Show Timesheet (today / week / date)

```text
User: "What did I log this week?" / "Show today"

AI Understanding: INT-006 / INT-007 / INT-008

Missing: weekStart if not inferable

Tool Calls: get_weekly_timesheet(weekStart)
  Optional: list_projects/list_tasks to decorate IDs with names

Confirmation: No

Success: Markdown table by date; hours totals
Failure: 401 → re-auth; empty → “No entries”
```

---

## FLOW-06 List Projects

```text
User: "List my projects" / "Projects for client Acme"

Tool Calls: list_projects()
Agent-local: filter by client/name substring (no search API)
Confirmation: No
Success: Client → Project Name (Code) [ProjectID]
Note: Catalog is global for all employees (code), not assignment-filtered
```

---

## FLOW-07 List Tasks

```text
User: "What tasks can I pick?"

Tool Calls: list_tasks()
Agent-local: optional filter by name
Success: Task name [TaskID]
Note: All tasks valid for any project per backend
```

---

## FLOW-08 Show Holidays

```text
User: "Any holidays this month?"

Tool Calls: get_holidays(year)
Agent-local: filter dates in month/week
Failure: cache empty → “Holiday data unavailable; ask admin to refresh cache”
  (matches holidays API behavior)
```

---

## FLOW-09 Show Leave

```text
User: "Am I on leave next week?"

Tool Calls: get_leave_monthly for each month spanning range
Agent-local: filter dates; show type FULL/HALF, leaveType, status (as returned — not filtered by Approved)
Confirmation: No
```

---

## FLOW-10 Create Custom Project

```text
User: "Create project 'Internal Hackathon' under New and log 2h Research today"

AI Understanding: INT-013 + INT-001

Tool Calls: list_projects (ensure name not already exact ProjectID / similar names warn)
           list_tasks; get_weekly_timesheet

Confirmation (Critical):
  “This will CREATE a new project in the shared Projects sheet:
   Name=…, Client=*New, Code=NEW-…
   Then save entry … Proceed?”

Execution: submit_day_timesheet with projectId = exact name string (not an existing ID)
  Backend createProject side effect (google-sheets.ts)

Success: report new ProjectID if reload lists after cache clear (cache TTL 5 min — may need list refresh)
```

---

## FLOW-11 Cancel

```text
User: "Cancel" / "Never mind"

AI Understanding: INT-016
Tool Calls: none
Action: clear pending_write; acknowledge
Success: “Cancelled. Nothing was saved.”
```

---

## FLOW-12 Correction

```text
User: (after AI asked for task) "Actually make it 3 hours" / "Use Testing not Development"

AI Understanding: INT-018
Update memory slots; re-show summary; do not write until INT-017
```

---

## FLOW-13 Multiple Entries

```text
User: "Yesterday: 4h Hertz Development, 2h Internal Meeting"

AI Understanding: INT-019
Resolve each line; merge_add twice onto loaded day
One confirmation for full day after-state
One submit_day_timesheet
```

---

## FLOW-14 Ambiguous Project

```text
User: "Log 8h on Hertz"

AI Understanding: INT-020 then INT-001
list_projects → multiple matches "Hertz*"
AI: numbered choices (Name, Client, Code, ID) — never pick silently
Wait for user selection → continue FLOW-01
```

---

## FLOW-15 Ambiguous Task

```text
Same pattern with list_tasks; never invent TaskID
Unknown free-text task that matches nothing → ask to pick from list (backend rejects unknown IDs)
```

---

## FLOW-16 Unknown Project

```text
No match in list_projects
AI MUST NOT call submit with the string yet
Offer:
  A) Pick closest existing (show candidates)
  B) Create custom *New project (FLOW-10) — only if user explicitly chooses create
```

---

## FLOW-17 Unknown Task

```text
No match → show list_tasks filter suggestions
Cannot create tasks via API (not in codebase)
User must pick existing TaskID
```

---

## FLOW-18 Future Date

```text
User: "Log 8h next Monday"

Backend: allows future dates (no restriction in submit Zod)
Agent policy (guardrail): warn “This is a future date ({date}). Save anyway?”
Confirm Yes → proceed FLOW-01
(Closed period: Not implemented in backend — do not claim period is closed)
```

---

## FLOW-19 Leave Day

```text
Before write: get_leave_monthly
If FULL leave for date:
  UI would disable editing (DailyCard) — agent SHOULD refuse write by default
  Message: “Zoho shows full-day leave ({leaveType}, status={status}). I won’t save hours unless you explicitly override.”
  If user overrides: confirm again then submit
    Note: backend will still accept (server does not enforce leave)
If HALF: warn; allow with confirmation
```

---

## FLOW-20 Holiday

```text
get_holidays; if date is holiday:
  UI allows edit (visual only) — agent SHOULD warn
  “{date} is holiday: {name}. Save hours anyway?”
  Confirm → submit
```

---

## FLOW-21 Copy Previous Day

```text
Emulate UI Copy Yesterday (client-only in app)
Preconditions (mirror UI): target empty preferred; source = previous calendar day in week or prior week load
get_weekly_timesheet for needed weeks
If target has entries → confirm replace vs merge
Confirmation: Yes
submit_day_timesheet with copied entries (resolved IDs already in source)
```

---

## Common failure branch (all write flows)

```text
401 → ask user to sign in to web app / refresh Slack link binding (binding missing today — see readiness)
400 Invalid task → FLOW-17
400 Validation → show server error string; ask corrected hours/date
503 busy / lock → wait and retry once; then ask user to retry later
500 → do not retry blindly if unsure whether write succeeded → get_weekly_timesheet to verify
```

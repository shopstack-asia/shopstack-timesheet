# 01 — AI Intent Catalog

**Traceability:** Intents only where discovery + code support them, or meta-intents (Help/Cancel/Confirm) that need no backend.

**Legend — Risk:** Low / Medium / High / Critical  
**Requires Confirmation:** Yes = must confirm before write tool; No = read-only or meta.

**MCP tools** = candidates from `docs/ai-discovery/07_mcp_tool_candidates.md` only.  
**Agent-local** = resolve/merge/confirm — not MCP tools.

---

## Intent table

| Intent ID | Description | Required backend APIs | Required MCP tools | Agent-local | Risk | Confirm |
|-----------|-------------|----------------------|--------------------|-------------|------|---------|
| INT-001 | Create / add time entry for a date | `GET` week, projects, tasks; `POST` submit | `get_weekly_timesheet`, `list_projects`, `list_tasks`, `submit_day_timesheet` | resolve project/task, merge add, confirm | High | **Yes** |
| INT-002 | Add more hours (same or new line) | same as INT-001 | same | merge add/update hours | High | **Yes** |
| INT-003 | Update hours on existing entry | same | same | merge update by Project\|Task | High | **Yes** |
| INT-004 | Delete one entry | same | `get_weekly_timesheet`, `list_*` if needed, `submit_day_timesheet` | merge delete key | High | **Yes** |
| INT-005 | Clear day (delete all entries) | `POST` submit `entries:[]` | `clear_day_timesheet` (or submit empty) | confirm | Critical | **Yes** |
| INT-006 | Show today’s timesheet | `GET` week | `get_weekly_timesheet` | derive Monday weekStart; slice date | Low | No |
| INT-007 | Show this week | `GET` week | `get_weekly_timesheet` | weekStart Monday | Low | No |
| INT-008 | Show specific date / range in week | `GET` week | `get_weekly_timesheet` | date resolve; slice | Low | No |
| INT-009 | Show holidays | `GET` holidays | `get_holidays` | year default | Low | No |
| INT-010 | Show leave | `GET` leave monthly (or range) | `get_leave_monthly` | year/month | Low | No |
| INT-011 | List projects | `GET` projects | `list_projects` | optional client filter | Low | No |
| INT-012 | List tasks | `GET` tasks | `list_tasks` | optional name filter | Low | No |
| INT-013 | Create custom project (with entry) | `POST` submit (side-effect createProject) | `list_projects`, `list_tasks`, `get_weekly_timesheet`, `submit_day_timesheet` | confirm name; never silent create | Critical | **Yes** |
| INT-014 | Who am I / my profile | `GET` profile | `get_current_employee` | — | Low | No |
| INT-015 | Help | none | none | explain capabilities | Low | No |
| INT-016 | Cancel | none | none | clear pending action | Low | No |
| INT-017 | Confirm pending write | pending write APIs | the pending write tool | execute after Yes | High | N/A (is confirm) |
| INT-018 | Correction (change pending draft before write) | none until execute | none until execute | update memory slots | Medium | No until write |
| INT-019 | Multi-entry add (several lines one day) | same as INT-001 | same | merge multiple adds; one submit | High | **Yes** |
| INT-020 | Resolve ambiguous project | `GET` projects | `list_projects` | disambiguate; no write | Medium | No (clarify) |
| INT-021 | Resolve ambiguous task | `GET` tasks | `list_tasks` | disambiguate | Medium | No (clarify) |
| INT-022 | Check leave day context | leave monthly | `get_leave_monthly` | warn if FULL; block write per guardrail | Medium | Yes if user still writes |
| INT-023 | Check holiday context | holidays | `get_holidays` | warn; UI does not block — agent policy | Medium | Yes if writing |
| INT-024 | Copy previous day (emulate UI) | get week + submit | `get_weekly_timesheet`, `submit_day_timesheet` | copy then merge/replace empty day | High | **Yes** |
| INT-025 | Persist multiple days / “submit week” | N × submit | N × `submit_day_timesheet` | orchestrate; confirm each or batch | Critical | **Yes** |

---

## Out-of-scope intents (no backend)

| Intent | Status | Evidence |
|--------|--------|----------|
| Approve timesheet | **Do not support** | No API (`docs/ai-discovery/01`) |
| Reject / return | **Do not support** | No API |
| Recall submission | **Do not support** | No API |
| Draft save to server | **Do not support** | No API |
| Copy previous week | **Do not support** | Not in code |
| Export / report | **Do not support** | No API |
| Missing hours vs policy | **Do not support as fact** | No standard hours in backend |
| Act as another employee | **Do not support** | Session binds EmployeeID |

Agent response for out-of-scope: explain capability is not available in the current Timesheet system.

---

## Intent details

### INT-001 Create / add time entry

- **Description:** User wants to log hours for a project/task on a date. Backend has no create-entry; agent must merge into day’s full set then `submit_day_timesheet`.
- **APIs:** `GET /api/timesheet/get`, `GET /api/master/projects`, `GET /api/master/tasks`, `POST /api/timesheet/submit`
- **Risk:** High — wrong merge deletes siblings; unknown project ID creates project
- **Confirm:** Yes — show final day entry table before write

### INT-005 Clear day

- **Description:** Remove all Time Log rows for a date.
- **APIs:** `POST /api/timesheet/submit` with `entries: []`
- **Risk:** Critical — irreversible from app (hard delete rows)
- **Confirm:** Yes — explicit “clear all entries for {date}”

### INT-013 Create custom project

- **Description:** User wants a project not in the catalog. Backend creates on submit when `projectId` is not a known ProjectID (`createProject`).
- **Risk:** Critical — mutates Projects sheet for all users
- **Confirm:** Yes — confirm exact name and that a new `*New` project will be created

### INT-025 Multi-day persist

- **Description:** Emulate UI “Submit Week” via sequential day submits (`submitWeekDaysSequentially` pattern). No single week API.
- **Risk:** Critical — partial failure possible across days
- **Confirm:** Yes — list all days/entries; warn about partial failure

---

## Meta intents

| ID | Behavior |
|----|----------|
| INT-015 Help | List supported intents; link to web `/timesheet` for full UI |
| INT-016 Cancel | Drop `pending_write`; keep soft context (last date) optional |
| INT-017 Confirm | Only if `pending_write` exists; then call write tool once |
| INT-018 Correction | Edit slots in memory before confirm |

# 09 — Conversation Memory

Temporary state for multi-turn Slack/chat. **Not persisted in Timesheet backend** (no draft API).

---

## State model

```text
ConversationState {
  thread_id: string              # Slack channel+thread or DM
  employee_binding: {
    status: "bound" | "unbound"
    employee_id?: string         # from profile when auth exists
    email?: string
  }
  timezone: string               # agent config, e.g. "Asia/Bangkok"

  context: {
    last_date?: string           # YYYY-MM-DD
    last_week_start?: string
    last_project_id?: string
    last_project_label?: string
    last_task_id?: string
    last_task_label?: string
    last_client?: string
    last_hours?: number
  }

  draft_entry?: {                # in-progress collection for INT-001
    date?: string
    project_query?: string
    project_id?: string          # set only after resolution
    project_create_name?: string # if creating
    task_query?: string
    task_id?: string
    hours?: number
    client_query?: string
  }

  pending_write?: {
    id: string
    created_at: number
    expires_at: number
    tool: "submit_day_timesheet" | "clear_day_timesheet"
    payload: { date: string, entries: Array<{projectId, taskId, hours}> }
    summary_text: string
    warnings: string[]
  }

  last_lists?: {
    projects_fetched_at?: number
    tasks_fetched_at?: number
  }

  flags: {
    await_disambiguation?: "project" | "task" | "merge_policy" | "leave_override"
    candidates?: Array<{ id: string, label: string }>
  }
}
```

---

## Example continuity

```text
User: Yesterday worked 8 hours on Hertz Development.
→ Memory: date=resolved, project/task unresolved or resolved, hours=8
→ AI asks project disambiguation if needed

User: add another 2 hours on Internal Meeting
→ AI reuses date=yesterday from context.last_date
→ Collects second line into DaySet merge with first (still pending until confirm)
```

If first entry was already **confirmed and submitted**, “add another 2 hours” → load week again → merge_add → new confirm (do not assume Sheets state from old memory alone).

---

## TTL

| State slice | Suggested TTL | Rationale |
|-------------|---------------|-----------|
| `pending_write` | **5–10 minutes** | Safety; reduces stale confirm |
| `draft_entry` / disambiguation | **30 minutes** | Conversation continuity |
| `context.last_*` | **24 hours** or end of calendar day in `timezone` | Soft defaults only |
| Cached list snapshots | **≤ 5 minutes** | Align with Sheets master cache TTL in code |

On TTL expiry of `pending_write`: delete it; tell user to re-confirm a fresh summary.

---

## Reset conditions

| Event | Action |
|-------|--------|
| Cancel / INT-016 | Clear `pending_write`, `draft_entry`, disambiguation flags; keep soft `context` optional |
| Successful write | Clear `pending_write` & `draft_entry`; update `context.last_*` from payload |
| Failed write | Keep `pending_write` until TTL or Cancel; allow retry after refresh get |
| User switches date explicitly | Update date; invalidate day-specific draft merge |
| Employee unbound / 401 | Clear all; refuse tools |
| New Slack thread | Fresh state (no cross-thread memory) |

---

## Thread behaviour

| Channel | Policy |
|---------|--------|
| Slack DM | One `ConversationState` per user DM |
| Channel + thread | State keyed by `thread_ts`; top-level channel messages start new thread or ask to reply in thread |
| Web chat (if any) | Session id key |

**Never** share one employee’s `pending_write` across users.

---

## What memory must not store

- OAuth secrets, Zoho tokens, Sheets private key  
- Other employees’ leave/timesheet data  
- Long-term “draft timesheets” as source of truth — Sheets after successful submit is truth  

---

## Interaction with backend drafts

**None.** Server has no draft. Memory is ephemeral UX only. User must Confirm to persist.

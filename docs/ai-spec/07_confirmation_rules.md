# 07 — Confirmation Rules

Confirmation = user explicitly approves the **final write payload** (or clear) before any `submit_day_timesheet` / `clear_day_timesheet` call.

---

## Always require confirmation

| Operation | Why |
|-----------|-----|
| Create / add entry | Day-replace can delete siblings if merge wrong; hours affect payroll sheet |
| Update entry | Changes persisted immediately to shared Sheets |
| Delete entry | Hard-deletes Time Log row(s) on submit |
| Clear day | Deletes **all** rows for date (`entries: []`) — irreversible in-app |
| Create custom project | Mutates shared Projects sheet for all employees (`createProject`) |
| Replace day wholesale | High blast radius |
| Multi-day / week persist | Partial failure risk; multiple Sheet mutations |
| Copy onto non-empty day | Overwrite risk |
| Write on FULL leave (override) | UI would block; server will not — need explicit override |
| Write on holiday | Product ambiguity; warn + confirm |
| Write on future date | Allowed by API but often unintentional |
| Sum hours policy (add vs replace duplicate key) | Ambiguous merge |

---

## Do not require confirmation

| Operation | Why |
|-----------|-----|
| Show timesheet / week / day | Read-only |
| List projects / tasks | Read-only |
| Show leave / holidays | Read-only |
| Profile | Read-only |
| Help / Cancel | Meta |
| Clarification questions (ambiguous project/task) | Not a write yet |
| Correction of pending slots before confirm | Still pre-write |

---

## Confirmation content (minimum)

For writes, message must include:

1. Date (YYYY-MM-DD)  
2. Full **after** entry list: Project name/code/id, Task name/id, Hours  
3. Day total hours  
4. Explicit callouts: custom project create, clear day, leave/holiday/future warnings  
5. How to confirm: e.g. reply `YES` / click Confirm (channel-specific)  
6. How to cancel: `Cancel`

For clear day: list entries that will be deleted.

---

## Confirmation tokens

Agent-local (not backend):

```text
pending_write = {
  id: uuid,
  expires_at,
  tool: "submit_day_timesheet" | "clear_day_timesheet",
  payload: { date, entries },
  summary_text
}
```

Only `INT-017 Confirm` matching `pending_write.id` (or single pending per thread) triggers execution.  
Stale confirm after TTL → refuse and re-summarize.

---

## Double confirm (critical)

Require second affirmation when:

- Clear day with ≥1 entry  
- Custom project create  
- Override FULL leave  

Example: “Type CLEAR to delete all Friday entries.”

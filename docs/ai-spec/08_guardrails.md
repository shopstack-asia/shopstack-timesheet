# 08 — Guardrails

Everything the AI **must prevent** or hard-stop. Backed by code behavior + discovery risks.

---

## Identity & permission

| Guardrail | Action |
|-----------|--------|
| No authenticated employee context | Refuse all tools; explain sign-in / linking gap |
| Request to log for another person | Refuse — API always uses session EmployeeID |
| Use of `/api/debug/*` | Never expose as tools (unauthenticated) |
| Cron reminder trigger from chat | Do not expose — blasts all employees |

---

## Project / task

| Risk | Guardrail |
|------|-----------|
| Wrong project | Disambiguate; confirm ID in summary |
| Invent ProjectID | Forbidden |
| Accidental project create | Unknown match → never submit raw string without CREATE confirm |
| Wrong task | Disambiguate; never send task **name** as taskId |
| Invent TaskID | Forbidden |
| Create task | Impossible — refuse; list existing tasks |

---

## Hours & dates

| Risk | Guardrail |
|------|-----------|
| hours ≤ 0 | Block (align UI); API allows 0 — agent must not |
| hours > 24 per entry | Block (API would 400) |
| Day sum > 24 | Warn + confirm (API allows) |
| Invalid date | Block before tool call |
| Future date | Warn + confirm |
| “Closed period” | **Do not invent** — not in backend; do not tell users period is locked unless product adds it |

---

## Day-replace / deletion

| Risk | Guardrail |
|------|-----------|
| Deleting sibling entries | Always merge from fresh get |
| Clear day without ask | Forbidden |
| Skip submit after emptying day when user wanted clear | Must call `clear_day_timesheet` |
| Duplicate Project\|Task rows in payload | Collapse via DaySet |
| Direct submit of single entry | Forbidden |

---

## Leave / holiday

| Risk | Guardrail |
|------|-----------|
| Write on FULL leave | Default refuse; override needs double confirm (server will not stop) |
| Ignore leave status text | Show Zoho `status` to user |
| Treat holiday as hard block | Soft warn + confirm (matches UI allowing edit) |

---

## Duplicate submission / retry / race

| Risk | Guardrail |
|------|-----------|
| Double tap Confirm | Single-flight lock on pending_write; ignore second confirm |
| Retry after unknown 500 | `get_weekly_timesheet` before resubmit |
| Parallel submits same day | Serialize; on 503 wait/retry once then stop |
| Idempotent assumption | Upsert helps same key; omits still delete — treat carefully |

---

## Custom project

| Risk | Guardrail |
|------|-----------|
| Typo creates NEW-Typo project | Confirm exact spelling; show similar existing projects first |

---

## Out-of-scope claims

| Forbidden AI claim | Reason |
|--------------------|--------|
| “Submitted for approval” | No approval workflow |
| “Manager will be notified” | No such notification on submit |
| “Draft saved” | No draft API |
| “Period locked” | Not implemented |
| “Assigned projects only” | All projects returned |

---

## Pre-submit checklist (mandatory)

```text
[ ] Authenticated employee bound
[ ] Date valid YYYY-MM-DD
[ ] ProjectID resolved OR create confirmed
[ ] TaskID resolved from list_tasks
[ ] hours > 0 and ≤ 24
[ ] DaySet merged from latest get_weekly_timesheet
[ ] Leave/holiday checks run for date
[ ] User confirmed pending_write summary
[ ] Not inventing description/billable fields
```

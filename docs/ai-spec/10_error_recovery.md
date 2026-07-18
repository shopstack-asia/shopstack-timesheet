# 10 — Error Recovery

Map backend / orchestration failures to user-friendly recovery. Error strings from `ApiResponse.error` unless noted.

---

## Authentication

| Error | Typical source | User message | Recovery |
|-------|----------------|--------------|----------|
| 401 Unauthorized | Missing session on timesheet/master/staff | “You’re not signed in to Timesheet.” | Open web app sign-in; complete Slack↔employee binding when available (binding **not in codebase today**) |
| 404 Staff profile not found | `/api/staff/profile` | “Your employee profile isn’t on the session.” | Re-login; verify Zoho employee exists (auth gate) |
| 404 EmployeeID not found | Leave APIs | “Leave can’t load without Employee ID.” | Re-login |

---

## Validation

| Error | Source | User message | Recovery |
|-------|--------|--------------|----------|
| Validation error (Zod) | submit | “That entry isn’t valid: {server message}” | Fix date format, hours 0–24, non-empty ids |
| Invalid task ID: X | submit | “Task `{X}` isn’t in the task list.” | `list_tasks` → pick valid TaskID (FLOW-17) |
| weekStart parameter is required | get | Internal agent bug | Recompute Monday weekStart |
| Invalid year/month | leave/holidays | “I need a valid year/month.” | Ask user |

---

## Project create / missing project

| Situation | User message | Recovery |
|-----------|--------------|----------|
| Agent almost sent unknown string | Stop | Offer match list or confirmed create (FLOW-16/10) |
| createProject / Project not found throw | “Couldn’t create or resolve that project.” | Retry after `list_projects`; check Sheets permissions (ops) |
| Accidental create feared | N/A | Always confirm before create path |

---

## Lock / Redis / concurrency

| Error | HTTP | User message | Recovery |
|-------|------|--------------|----------|
| Timesheet is busy, please try again | 503 | “Timesheet is busy (another save in progress).” | Wait 5–10s; `get_weekly_timesheet`; re-confirm if needed; retry **once** |
| Timesheet write lock unavailable… | 503 | “Can’t save right now (storage lock unavailable).” | Retry later; ops check Redis (`docs/ai-discovery`) |
| Partial week day failures | client pattern | “Saved Mon–Wed; failed Thu: {error}.” | Fix failed days only; don’t re-submit successful days blindly without get |

---

## Holidays / leave reads

| Error | User message | Recovery |
|-------|--------------|----------|
| Failed to retrieve holidays from cache… | “Holiday data isn’t loaded.” | Ask admin to run holiday refresh cron; don’t invent holidays |
| Zoho/Redis leave failure | “Couldn’t load leave.” | Proceed with write only after warning that leave is unknown; or abort writes |

---

## Network / timeout / 500

| Error | User message | Recovery |
|-------|--------------|----------|
| Network / timeout | “I couldn’t reach Timesheet.” | Retry read; for writes → `get_weekly_timesheet` to see if save landed |
| 500 Failed to submit… | “Save failed: {message}.” | Verify with get; then rebuild merge from fresh data |
| 500 Failed to fetch time log | “Couldn’t load your timesheet.” | Retry; block writes until load succeeds |

---

## Resolution failures (agent-local)

| Case | User message | Recovery |
|------|--------------|----------|
| Ambiguous project | “Which project?” + numbered list | Wait for selection |
| Ambiguous task | “Which task?” | Wait |
| Unknown task | “I can’t create tasks. Pick one:” | list_tasks |
| Unknown project | “No match. Pick existing or create new (confirm).” | FLOW-16 |
| Stale pending_write | “Confirmation expired.” | Rebuild summary |

---

## Guardrail refusals (not backend errors)

| Case | User message |
|------|--------------|
| FULL leave default block | “You’re on full-day leave ({type}, status {status}). Say OVERRIDE to save anyway.” |
| hours ≤ 0 | “Hours must be greater than 0.” |
| Out-of-scope approve | “Approval isn’t available in this Timesheet system.” |

---

## Recovery principles

1. **Never** retry write without understanding current Sheets state (`get_weekly_timesheet`).  
2. Prefer **one** automatic retry for 503 lock only.  
3. Surface **server `error` string** when present — do not invent error codes the API does not return.  
4. After recovery, re-run confirmation before write.

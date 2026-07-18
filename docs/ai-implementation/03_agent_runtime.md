# 03 — Agent Runtime

## Intent

`OpenAICompatibleModel` (`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`) with Zod `AgentDecisionSchema`, plus rule-based fallback.

**Critical confirmations are never LLM-only.** Execution uses deterministic normalized keywords in `confirm-keywords.ts`:

| Keyword | Role |
|---------|------|
| `YES` (+ Thai `ยืนยัน`) | Confirm a normal day write |
| `CLEAR` | Confirm clear-day |
| `OVERRIDE` | Acknowledge full-day leave (does **not** write) |
| `CANCEL` (+ Thai `ยกเลิก`) | Abort pending / draft |

Phrases like “looks good” / “go ahead” never execute a write even if the model classifies `confirm`.

## Write path

1. Resolve date (timezone `TIMESHEET_AGENT_TIMEZONE`)
2. `list_projects` / `list_tasks` + resolution (never invent IDs; **custom project creation disabled** in Slack)
3. Load day → DaySet merge with operation metadata (`operationType`, `targetEntryKey`, `baseSnapshot`)
4. Leave / holiday / future / over-24 guardrails
5. Full leave: store draft + `awaitingLeaveOverride` → user types `OVERRIDE` → rebuild summary → still requires `YES`
6. Redis `PendingWrite` (10 min TTL) with `baseFingerprint`
7. On confirm: **atomic claim** (`SET NX` claim key) → reload day → if fingerprint changed, re-merge and require new confirm → else submit → **post-save verify** → “Saved.” only on match
8. Audit log line `timesheet_agent_audit`

## Atomic claim

`claimPendingWrite` acquires `timesheet-agent:pending-claim:{id}` with `SET NX` + TTL, then transitions `pending` → `executing`. Concurrent confirmations: exactly one succeeds; others get `null`.

## Stale snapshot

Before submit, reload the day and compare `dayFingerprint` to `baseFingerprint`. If changed, reapply the intended operation against the latest day, show a new summary, and require a new keyword. Never submit a stale full-day payload that would drop concurrent rows.

## Post-save verification

`verify.ts` normalizes expected vs actual by ProjectID / TaskID / Hours (sorted). Mismatch → explicit failure (no “Saved.”), no automatic destructive retry.

## Sheets write order

`submitDayTimesheetForStaff`: validate → resolve projects → prepare rows → **upsert first** → **delete obsolete after**. On delete failure after upsert, attempt snapshot restore. Slack path sets `allowCustomProject: false`.

## Empty clear

If the day has no entries, reply `The day is already empty.` — no pending write, no `CLEAR`, no submit.

## State

Redis keys:

- `timesheet-agent:conv:{channel}:{thread}`
- `timesheet-agent:pending:{id}`
- `timesheet-agent:pending-claim:{id}`
- `timesheet-agent:thread-pending:{threadKey}`
- `timesheet-agent:event:{eventId}` (prefer Slack envelope `event_id`; fallback `client_msg_id` / `event_ts`)

# 03 — Agent Runtime

## Intent

`OpenAICompatibleModel` (`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`) with Zod `AgentDecisionSchema`, plus rule-based fallback for YES/CANCEL/CLEAR/OVERRIDE and common phrases.

## Write path

1. Resolve date (timezone `TIMESHEET_AGENT_TIMEZONE`)  
2. `list_projects` / `list_tasks` + resolution (never invent IDs)  
3. `get_weekly_timesheet` → DaySet merge  
4. Leave/holiday guardrails  
5. Redis `PendingWrite` (10 min TTL)  
6. On confirm: claim once → `submit_day_timesheet` / clear → reload verify  
7. Audit log line `timesheet_agent_audit`

## State

Redis keys:

- `timesheet-agent:conv:{channel}:{thread}`  
- `timesheet-agent:pending:{id}`  
- `timesheet-agent:thread-pending:{threadKey}`  
- `timesheet-agent:event:{eventId}` (dedupe)

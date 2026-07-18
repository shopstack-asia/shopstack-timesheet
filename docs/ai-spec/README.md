# AI Conversation & Tool Orchestration Specification — Index

**Mode:** Specification only — no application code changes.  
**Sources:** `src/**`, [`docs/ai-discovery/`](../ai-discovery/), existing Sheets/Zoho/Redis behavior.  
**Commit baseline:** `e8af4c6095ffcc6131f8beed890719bd3bc4d9ca`

---

## Non-negotiable rules for implementers

1. **Do not invent backend APIs.** Only call endpoints documented in `docs/ai-discovery/01_existing_apis.md`.
2. **Do not invent MCP tools.** Only use candidates from `docs/ai-discovery/07_mcp_tool_candidates.md`.
3. **Agent-local steps** (resolve, merge, confirm, date parse) are orchestration logic — not new HTTP APIs.
4. **Write path is day-replace:** `submit_day_timesheet` → `POST /api/timesheet/submit`. Never treat it as create-entry.
5. **Never auto-create projects** without explicit user confirmation (unknown `projectId` creates a Sheets row).

---

## Document map

| # | File | Contents |
|---|------|----------|
| 01 | [01_intent_catalog.md](./01_intent_catalog.md) | User intents, APIs, tools, risk, confirmation |
| 02 | [02_conversation_flows.md](./02_conversation_flows.md) | End-to-end conversation flows |
| 03 | [03_information_collection.md](./03_information_collection.md) | Required / optional / derived / never-guess |
| 04 | [04_tool_orchestration.md](./04_tool_orchestration.md) | Tool call sequences |
| 05 | [05_merge_strategy.md](./05_merge_strategy.md) | Safe merge for day-replace backend |
| 06 | [06_resolution_strategy.md](./06_resolution_strategy.md) | Project/task/client/date resolution |
| 07 | [07_confirmation_rules.md](./07_confirmation_rules.md) | When confirmation is mandatory |
| 08 | [08_guardrails.md](./08_guardrails.md) | What the agent must prevent |
| 09 | [09_conversation_memory.md](./09_conversation_memory.md) | Temporary conversation state |
| 10 | [10_error_recovery.md](./10_error_recovery.md) | Backend error → user recovery |
| 11 | [11_ai_ux_rules.md](./11_ai_ux_rules.md) | Response / Slack formatting |
| 12 | [12_ai_readiness_assessment.md](./12_ai_readiness_assessment.md) | Readiness scores and gaps |

Discovery inputs: [`docs/ai-discovery/README.md`](../ai-discovery/README.md).

---

## MCP tools allowed in this spec

From discovery (candidates — not yet implemented as MCP server):

```text
get_current_employee
list_projects
list_tasks
get_weekly_timesheet
get_holidays
get_leave_monthly
get_leave_range          # optional; UI uses monthly
get_leave_yearly         # optional
submit_day_timesheet
clear_day_timesheet
```

**Out of scope intents** (no backend): Approve, Reject, Recall, Draft save, Copy previous week, Reporting, Missing-hours calc as a product rule.

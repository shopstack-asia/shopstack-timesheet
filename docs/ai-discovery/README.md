# AI Agent Discovery — Index

Technical discovery for building an AI Agent and Slack integration against **Shopstack Timesheet**.

**Mode:** Inspection only — no implementation.  
**Source of truth:** application source under `src/`.  
**Commit:** `e8af4c6095ffcc6131f8beed890719bd3bc4d9ca` (`main`)

---

## Documents

| # | File | Contents |
|---|------|----------|
| 01 | [01_existing_apis.md](./01_existing_apis.md) | Every timesheet-related API, categorized |
| 02 | [02_business_operations.md](./02_business_operations.md) | Business operations and API mapping |
| 03 | [03_ai_candidate_operations.md](./03_ai_candidate_operations.md) | AI suitability ratings |
| 04 | [04_project_task_resolution.md](./04_project_task_resolution.md) | Project / task / user / department resolution |
| 05 | [05_required_information.md](./05_required_information.md) | Mandatory / optional / defaults / ask-user |
| 06 | [06_ai_integration_risks.md](./06_ai_integration_risks.md) | Risk cases vs current backend handling |
| 07 | [07_mcp_tool_candidates.md](./07_mcp_tool_candidates.md) | MCP tools mapped only to existing APIs |
| 08 | [08_slack_readiness.md](./08_slack_readiness.md) | Slack sufficiency and gaps |

Related system docs: [`docs/timesheet/`](../timesheet/).

---

## One-line findings

- **Write surface:** one endpoint — `POST /api/timesheet/submit` (day replace).  
- **Approval / reporting / draft / recall:** not in codebase.  
- **Slack today:** outbound reminders only; no inbound agent APIs or Slack↔employee identity.  
- **Safest AI start:** read tools (profile, week, projects, tasks, leave, holidays).

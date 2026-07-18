# 12 — AI Readiness Assessment

Evaluation of **current** Shopstack Timesheet backend + discovery for implementing this conversation/orchestration spec.  
Scores: 1 (not ready) – 5 (ready). Traceable to `docs/ai-discovery/*` and `src/`.

---

## Scores

| Dimension | Score | Rationale |
|-----------|:-----:|-----------|
| Conversation Readiness | **4** | Flows/spec can be designed; ephemeral memory only; no draft API |
| API Readiness | **3** | Strong reads; single day-replace write; no entry CRUD/search/approval |
| Slack Readiness | **2** | Outbound reminders only; no inbound agent, no Slack↔EmployeeID (`08_slack_readiness`) |
| AI Readiness | **3** | Reads safe; writes viable only with merge+confirm guardrails |
| MCP Readiness | **3** | Tool candidates map cleanly to existing routes; MCP server **not implemented**; auth bridge missing |

**Overall:** Spec is implementation-ready for an **agent layer**; production Slack AI writes are **blocked** by identity/auth and operational gaps below.

---

## Missing capabilities

### Critical

| Gap | Why critical | Evidence |
|-----|--------------|----------|
| Slack (or bot) → EmployeeID + session auth for `/api/*` | Tools cannot run as user | discovery 08; NextAuth session |
| Enforce or consciously accept leave on server | UI blocks; API does not | DailyCard vs submit |
| Agent merge+confirm mandatory for writes | Day-replace deletes siblings | submit route |
| Lock down `/api/debug/*` | Unauthenticated probes | debug routes |
| Never silent custom project create | Unknown projectId creates Sheets row | createProject |

### Recommended

| Gap | Why |
|-----|-----|
| Entry-level CRUD or documented merge helper API | Reduces agent foot-guns |
| Project/task search API | Avoid full-list filter only |
| Filter leave by ApprovalStatus | Pending leave UX ambiguity |
| Holiday cache freshness SLO | get_holidays fails if cold |
| Idempotency-Key on submit | Slack retries |
| Audit log of submits | Agent attribution |
| Explicit timezone config for Slack | Backend has none |
| Fix empty-day skip vs clear semantics in product | UI vs clear intent |

### Optional

| Gap | Why |
|-----|-----|
| Approve/reject workflow | Out of scope today |
| Draft save API | Nice for long chats |
| Copy-previous-day API | Emulatable |
| Reporting / missing hours | Not in product |
| Department model | Not in code |
| `submit_week` backend | Emulatable with N posts |

---

## What can ship first (given only existing APIs)

1. **Read-only Slack/AI assistant:** profile, week, projects, tasks, leave, holidays — after auth binding exists.  
2. **Write-capable agent:** only with SEQ-A merge strategy + confirmation + guardrails in agent host — still needs auth binding.

---

## Spec completeness vs code

| Spec area | Backed by existing APIs? |
|-----------|--------------------------|
| Intent catalog writes | Yes via submit + merge |
| Approval intents | Explicitly out of scope |
| MCP tool list | Subset of discovery 07 only |
| Resolution | Agent-local over list APIs |
| Confirmation / memory | Agent-local (no backend) |

---

## Confidence

| Claim | Class |
|-------|-------|
| Scores and gaps above | Inferred from confirmed code capabilities |
| API behaviors | Confirmed by code / ai-discovery |
| “MCP server exists” | **False** — candidates only |

---

## Next step (documentation boundary)

This folder is the **conversation & orchestration contract**.  
Implementation of MCP server, Slack Bolt app, or auth bridge is **out of scope** for this deliverable and must not invent Timesheet endpoints beyond `docs/ai-discovery/01_existing_apis.md`.

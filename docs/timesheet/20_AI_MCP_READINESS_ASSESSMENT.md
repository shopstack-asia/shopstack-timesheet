# 20 — AI and MCP Readiness Assessment

**Purpose:** Assess whether the **existing** system can support future AI / MCP tooling. **Does not design** the MCP server or Slack agent.

**Confidence:** Confirmed by code for current capabilities; readiness judgments are analytical.

---

## Capability matrix

| Capability | Supported | Existing API | Permission Safe | Idempotent | Audit Logged | Gap |
| ---------- | --------: | ------------ | --------------: | ---------: | -----------: | --- |
| Search employee projects | Partial | `GET /api/master/projects` | Yes (session) | Yes (read) | No | Returns **all** projects, not assignment-scoped; no text search API |
| Search tasks | Partial | `GET /api/master/tasks` | Yes | Yes | No | Full list only; no search/filter API |
| Retrieve current user | Yes | session / `GET /api/staff/profile` | Yes | Yes | No | — |
| Retrieve daily timesheet | Partial | `GET /api/timesheet/get` | Yes (own) | Yes | No | Week-based; client slices one day |
| Retrieve weekly timesheet | Yes | `GET /api/timesheet/get` | Yes | Yes | No | — |
| Create draft entry | No | — | — | — | No | Drafts exist only in browser state |
| Create confirmed entry | Partial | `POST /api/timesheet/submit` | Own only | Upsert by key | No | Day replace semantics; not single-entry CRUD |
| Update entry | Partial | submit upsert | Own | Upsert | No | Same as submit day payload |
| Delete entry | Partial | submit omit key or empty entries | Own | Yes | No | UI week submit won’t clear empty days |
| Validate entry before save | Partial | Zod on submit; UI rules | — | — | No | No dedicated validate endpoint; leave/holiday not validated server-side |
| Submit timesheet | Yes | submit (+ client sequential week) | Own | Partial | No | Means “write Sheets”, not approval submit |
| Approve timesheet | No | — | — | — | — | Requires new API |
| Reject timesheet | No | — | — | — | — | Requires new API |
| Retrieve approval status | No | — | — | — | — | No status model |
| Retrieve missing hours | No | — | — | — | — | No standard hours rules |
| Retrieve working calendar | No | — | — | — | — | No calendar entity |
| Retrieve holidays | Yes | `GET /api/timesheet/holidays` | Session | Yes | No | Cache-dependent |
| Retrieve leave | Yes | `/api/staff/leave*` | Own | Yes | No | Status filter gap |
| Idempotent write operations | Partial | Upsert Time Log ID | — | Partial | No | No Idempotency-Key; day replace deletes omitted keys |
| Audit logging | No | — | — | — | No | Gap for agents |
| Service-account authentication | No | — | — | — | — | Cron secret ≠ user delegation; NextAuth session for APIs |
| User delegation | No | — | — | — | — | Cannot act as user without their session |
| Slack identity mapping | No | — | — | — | — | Slack used for channel blast only |
| Human confirmation | Partial | UI alerts only | — | — | No | No confirmation token API |
| Structured error response | Yes | `ApiResponse.error` + status | — | — | No | String errors, not error codes |

---

## Candidate MCP tools (proposed names only — **do not exist**)

| Candidate tool | Mapping to today | Readiness |
|----------------|------------------|-----------|
| `get_current_employee` | staff profile / session | Directly supported (via session adapter) |
| `list_available_projects` | master projects | Supported with adapter (add search later) |
| `search_available_tasks` | master tasks | Supported with adapter |
| `get_daily_timesheet` | slice of get week | Supported with adapter |
| `get_weekly_timesheet` | get | Directly supported |
| `get_leave_for_range` | leave APIs | Directly supported |
| `get_holidays` | holidays API | Directly supported (ensure cache warm) |
| `validate_time_entry` | — | Requires new API (or replicate Zod + missing leave rules) |
| `create_time_entry` / `update` / `delete` | day submit replace | Supported with adapter **unsafe** without redesign of entry CRUD + confirmation |
| `submit_timesheet` | submit | Supported with adapter — clarify means persist not approve |
| `approve_timesheet` | — | Not currently possible |
| `reject_timesheet` | — | Not currently possible |
| `get_missing_hours` | — | Requires new API + policy |
| `send_reminder` | friday-reminder | Unsafe without redesign (blast all; cron secret) |

### Readiness legend (as used above)

- **Directly supported** — existing API covers the tool with thin wrapping  
- **Supported with adapter** — possible by composing existing APIs with care  
- **Requires new API** — cannot do correctly today  
- **Not currently possible** — domain feature absent  
- **Unsafe without redesign** — technically callable but fails permission/audit/confirmation expectations for agents  

---

## Recommended prerequisites before MCP / AI write access

1. Close or protect `/api/debug/*`  
2. Server-enforce leave/holiday (and define Approved-only leave policy)  
3. Explicit entry-level CRUD or documented day-replace contract for agents  
4. Fix empty-day delete semantics  
5. Add audit log (who/when/what hours written)  
6. Service identity + user delegation model (Slack user → EmployeeID)  
7. Human confirmation step for writes  
8. Stable error codes for agent recovery  
9. Do not expose approve/reject until those workflows exist  

---

## Read-only MCP slice (lowest risk today)

A read-only agent could today wrap:

- profile, weekly get, projects, tasks, leave monthly, holidays  

with session or future delegated auth — **after** debug routes are secured and holiday cache operational guarantees are documented.

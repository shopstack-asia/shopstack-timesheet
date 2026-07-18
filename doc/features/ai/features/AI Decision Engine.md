# AI Decision Engine

### Overview

Deterministic router that maps user intent to Business Tools before (and if needed instead of) trusting the model to call tools.

### Business Purpose

Business data must never come from model knowledge. Recognized and potential employee-business intents are prevented from answering directly and must route to a Business Tool or clarification.

Exact-tool enforcement on round 0 remains mandatory via `enforceRequiredBusinessTool()`.

### Fail-closed routing order

1. Empty message → `none`
2. Clearly general conversation → `none`
3. Ambiguous / invalid date → `clarify`
4. Explicit ISO date range → `get_timesheet_range` (wins over project/client words in the same message)
5. Relative range → `get_timesheet_range`
6. Explicit or relative single date → `get_timesheet`
7. Work context / project / client / role / assignment → `get_work_context`
8. Potential timesheet intent without a resolvable period → `clarify` (`missing_timesheet_period`)
9. Potential employee-work intent → `get_work_context`
10. Clearly non-business → `none`

Unresolved timesheet asks never default to today or the current week.

### Potential business-intent detection

`isPotentialBusinessIntent()` combines:

- **Personal-data signals** — I / me / my / am I / ฉัน / ผม / ของฉัน / รับผิดชอบ / …
- **Work-domain signals** — assignment, account, responsibility, working on, โปรเจกต์, ดูแลงาน, …

Broader assignment vocabulary (English and Thai) routes to `get_work_context` with reason `potential_work_context_intent`.

### Personal data vs conceptual questions

| Example | Outcome |
|---------|---------|
| What is a timesheet? | `none` (conceptual) |
| Show my timesheet | `clarify` (needs date/range) |
| What does a project manager do? | `none` |
| Which projects am I assigned to? | `get_work_context` |
| What am I currently working on? | `get_work_context` |

### Explicit date ranges

Detected **before** single-date and work-context routing. Invalid / reversed / >31-day ranges → `clarify` without LLM or tools.

### Round-0 required-tool enforcement

When the Decision Engine returns `call_tool`:

1. Inspect model tool calls on round 0.
2. An unrelated tool (`ping`, `current_date`, wrong Business Tool, etc.) does **not** satisfy the gate.
3. If the required tool is absent, inject the Decision Engine call (name + arguments).
4. If the required tool is present, keep a single call and overwrite arguments with Decision Engine values.
5. Missing registry tool or `enableTools: false` → controlled error (no business answer from the model).

### Code

- `src/lib/ai/decision-engine.ts`
- `src/lib/ai/conversation.ts` (`enforceRequiredBusinessTool`)
- `src/lib/ai/prompt.ts`
- `src/lib/tools/business/timesheet/bangkok-dates.ts`

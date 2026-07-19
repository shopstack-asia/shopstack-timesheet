# AI Decision Engine

### Overview

Deterministic router that maps user intent to Business Tools or clarification — never an LLM classifier.

Recognized and potential employee-business requests must route to a Business Tool or clarification. Clearly general, conceptual, instructional, programming, news, weather, and external-topic questions remain direct-answer requests.

Exact-tool enforcement on round 0 remains mandatory via `enforceRequiredBusinessTool()`.

### Fail-closed routing order

General-intent override runs **before** date and work keyword routing.

1. Empty → `none`
2. Clearly general conversation → `none`
3. Ambiguous / invalid date → `clarify`
4. Explicit ISO date range → `get_timesheet_range` (wins over project/client words)
5. Relative timesheet range → `get_timesheet_range` (week/month phrases only)
6. Explicit or relative single date → `get_timesheet` (includes standalone `today` / `วันนี้`)
7. Current-user identity / profile → `get_my_profile` (before work-context)
8. Explicit employee work-context request → `get_work_context`
9. Timesheet request missing date/range → `clarify` (`missing_timesheet_period`)
10. Potential employee-business request → `get_work_context`
11. Non-business → `none`

Unresolved timesheet asks never default to today or the current week.

### Separated detectors

| Helper | Responsibility |
|--------|----------------|
| `isClearlyGeneralConversation` | Orchestrates general categories |
| `isGeneralConceptualQuestion` | What is / Explain / Define / … |
| `isGeneralInstructionalQuestion` | How do I… (I alone ≠ employee data) |
| `isGeneralNewsOrExternalTopic` | News, weather, holidays, events |
| `isMyProfileRequest` | Who am I / my employee ID / Timesheet identity (Conversation Context → Staff ID; no Zoho in tool) |
| `isWorkContextRequest` | Employee assignment / projects / clients / roles |
| `isTimesheetDomainRequest` | Employee timesheet / logged hours |
| `isEmployeeBusinessRequest` | Phrase-level personal business structure |

Raw keywords (`project`, `summary`, `สรุป`) alone do **not** imply employee business intent.

### Standalone relative days

After general-check, these call `get_timesheet` with Bangkok calendar dates:

- `today` / `วันนี้`
- `yesterday` / `เมื่อวาน`
- `tomorrow` / `พรุ่งนี้`

They must never fall through to `get_work_context`.

General questions that merely mention a relative day (`What day is today?`, `สรุปข่าววันนี้`) are classified as general **before** date routing.

### Range keywords

Isolated `summary` / `สรุป` does **not** imply the current week.

Requires an actual range phrase (e.g. `this week`, `สัปดาห์นี้`, `Summary for this week`, `สรุป Timesheet สัปดาห์นี้`).

### Round-0 required-tool enforcement

When the Decision Engine returns `call_tool`, the conversation loop requires that exact tool with Decision Engine arguments. Wrong tools (`ping`, `current_date`, wrong Business Tool) do not satisfy the gate.

### Code

- `src/lib/ai/decision-engine.ts`
- `src/lib/ai/conversation.ts` (`enforceRequiredBusinessTool`)
- `src/lib/tools/business/timesheet/bangkok-dates.ts`

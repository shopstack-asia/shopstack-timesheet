# AI Prompt Strategy

### Overview

Foundation system prompt for AI Timesheet with tool-calling reliability rules.

### Foundation system prompt

The builder always starts with a Tool Calling Reliability prompt that:

- Identifies the assistant as AI Timesheet  
- Declares Business Tools as the source of truth for business data  
- Requires tool execution before answering business questions  
- Forbids fabricating timesheet/project/client/role data  
- Allows direct answers only for greeting / thanks / joke / general knowledge / programming  
- Requires explaining actual tool failures (auth, timeout, validation, empty)  
- Allows demonstration tools: `ping`, `current_time`, `current_date`  
- Maps identity / work context / single-day / range / write-prepare / confirm / cancel intents to Business Tools  
- Documents `get_my_profile` (empty args; Conversation Context only; reports canonical Time Log Staff ID; no Zoho re-verify)  
- Documents confirmation-gated write tools (prepare never writes Sheets; confirm by `confirmationId` only)  
- Resolves relative dates in `Asia/Bangkok`  
- **Slack Response Style**: same language as user; Slack mrkdwn (`*bold*`, `•` lists); compact daily/range/confirmation answers; Task ≠ Role; expected/remaining hours only when asked  

Canonical text lives in `src/lib/ai/prompt.ts` (`AI_TIMESHEET_SYSTEM_PROMPT`).

### Slack presentation

- Slack uses **mrkdwn**, not GitHub Markdown (`**bold**` is wrong for Slack).
- Final AI text is passed through `normalizeSlackMrkdwn()` in `src/lib/slack/mrkdwn.ts` immediately before `chat.postMessage` (`src/lib/slack/responses.ts`).
- Compact daily example (Thai): total hours first, then `• *Client* — Project: Task Hours`.
- See [Slack Response Architecture.md](../../slack/features/Slack%20Response%20Architecture.md).

See also [AI Decision Engine.md](./AI%20Decision%20Engine.md) for:

- general-intent override before business/date routing (conceptual, instructional How do I, news/weather, programming)
- personal identity → `get_my_profile` (before work-context; no Zoho inside the tool)
- standalone relative-day → `get_timesheet` (never `get_work_context`)
- why isolated `summary` / `สรุป` does not imply the current week
- employee-specific vs conceptual questions
- missing-period clarification and exact-tool enforcement

### Builder API

```ts
buildPrompt({ userMessage, metadata?, extraSystemSegments? })
```

- `metadata` is accepted for future injection (not injected into prompts yet)  
- `extraSystemSegments` appends system text (decision-engine hints, policy, memories later)  
- Tool **schemas** are passed separately via the OpenAI client `tools` array (from Tool Registry)

### Extensibility

Later phases can:

1. Pass company policy segments  
2. Register business tools in the Tool Registry (Conversation Service unchanged)  
3. Inject memory summaries as extra system segments  

Conversation Service stays free of business tool implementations; it uses the Decision Engine for intent routing.

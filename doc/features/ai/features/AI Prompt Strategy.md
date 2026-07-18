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
- Maps work context / single-day / range intents to Business Tools  
- Resolves relative dates in `Asia/Bangkok`  

Canonical text lives in `src/lib/ai/prompt.ts` (`AI_TIMESHEET_SYSTEM_PROMPT`).

See also [AI Decision Engine.md](./AI%20Decision%20Engine.md) for fail-closed potential-business-intent detection (personal-data vs conceptual questions), explicit ISO ranges, Bangkok tomorrow resolution, unresolved timesheet-period clarification, and round-0 enforcement that requires the exact Business Tool.

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

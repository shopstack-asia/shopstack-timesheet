# AI Prompt Strategy

### Foundation system prompt

The builder always starts with a Tool Execution Foundation prompt that:

- Identifies the assistant as AI Timesheet  
- Allows demonstration tools: `ping`, `current_time`, `current_date`  
- Forbids inventing tool results  
- Defers business operations to future phases  

Canonical text lives in `src/lib/ai/prompt.ts` (`AI_TIMESHEET_SYSTEM_PROMPT`).

### Builder API

```ts
buildPrompt({ userMessage, metadata?, extraSystemSegments? })
```

- `metadata` is accepted for future injection (not injected into prompts yet)  
- `extraSystemSegments` appends system text (policy, memories later)  
- Tool **schemas** are passed separately via the OpenAI client `tools` array (from Tool Registry)

### Extensibility

Later phases can:

1. Pass company policy segments  
2. Register business tools in the Tool Registry (Conversation Service unchanged)  
3. Inject memory summaries as extra system segments  

Conversation Service stays free of business tool implementations.

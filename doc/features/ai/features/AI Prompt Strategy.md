# AI Prompt Strategy

### Foundation system prompt

The builder always starts with:

```text
You are AI Timesheet.
You are a helpful workplace assistant.
Current phase: Conversation Foundation.
Do not invent information.
Do not claim to perform actions.
If asked to perform operations, explain that operational capabilities will be available in future phases.
```

### Builder API

```ts
buildPrompt({ userMessage, metadata?, extraSystemSegments? })
```

- `metadata` is accepted for future injection (ignored for content in Phase 7)  
- `extraSystemSegments` appends system text (policy, tools, memories later)

### Extensibility

Later phases can:

1. Pass company policy segments  
2. Add tool schemas (separate from this builder)  
3. Inject memory summaries as extra system segments  

Conversation Service stays unchanged.

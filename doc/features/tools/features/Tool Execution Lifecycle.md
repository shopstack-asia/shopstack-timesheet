# Tool Execution Lifecycle

## Stages

1. **Tool requested** — router logs requestId / eventId / toolName
2. **Validate** — name format + JSON arguments object
3. **Resolve** — registry.get; unknown → `errorCode: unknown_tool`
4. **Execute** — executor starts timer, applies timeout / retries / AbortSignal
5. **Complete** — normalize ToolResult (success or failure + durationMs)
6. **Returned** — router logs outcome; Conversation appends `role: tool` message

## ToolResult shapes

Success:

```json
{
  "success": true,
  "tool": "ping",
  "durationMs": 5,
  "result": { "message": "pong" }
}
```

Failure:

```json
{
  "success": false,
  "tool": "ping",
  "durationMs": 12,
  "errorCode": "timeout",
  "errorMessage": "Tool execution timed out"
}
```

## Error codes

| Code | Meaning |
|------|---------|
| `unknown_tool` | Not in registry |
| `validation_error` | Bad name or arguments |
| `timeout` | Exceeded executor timeout |
| `execution_failure` | Tool-reported / retryable failure |
| `cancelled` | AbortSignal aborted |
| `unexpected` | Uncaught exception |

## Conversation loop

- Max **3** tool rounds per user turn (`MAX_TOOL_ROUNDS`)
- Each round: LLM → optional tool_calls → execute all → append results → LLM again
- Final turn must be plain text (validated length)

## Source Code References

- `src/lib/tools/router.ts`
- `src/lib/tools/executor.ts`
- `src/lib/ai/conversation.ts`

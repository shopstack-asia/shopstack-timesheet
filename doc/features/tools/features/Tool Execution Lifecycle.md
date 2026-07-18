# Tool Execution Lifecycle

## Stages

1. **Tool requested** — router logs requestId / eventId / toolName
2. **Validate** — name format + JSON arguments object
3. **Resolve** — registry.get; unknown → `errorCode: unknown_tool`
4. **Execute** — per-attempt AbortController (parent + timeout), cooperative cancel, safe retries
5. **Complete** — normalize ToolResult (success or failure + durationMs)
6. **Returned** — router logs outcome; Conversation appends `role: tool` message

## Cooperative cancellation

Every attempt creates an `AbortController`. The executor merges:

- parent `context.signal` (caller cancel)
- timeout timer

into **one** `signal` passed to `tool.execute(input, { …context, signal })`.

On timeout or parent abort the executor:

1. logs `timeout` (when applicable) and `abort requested`
2. calls `controller.abort()`
3. **awaits tool settlement** (no orphan)
4. logs `tool cancelled`
5. returns failure **or** retries (see below)

Tools MUST honor `context.signal` and stop promptly. Ignoring abort blocks retries until settlement (by design — safer than duplicates).

## Retry semantics

| Condition | Retry? |
|-----------|--------|
| `tool.idempotent !== true` (default) | **Never** |
| Parent cancel (`cancelled`) | **Never** |
| Timeout / transient `execution_failure` **and** `idempotent: true` | Allowed up to `maxRetries` |
| Previous attempt still running | **Impossible** — settlement required first |

Demo tools (`ping`, `current_time`, `current_date`) set `idempotent: true`. Future business tools default to `false` until reviewed.

## Execution guarantees

- No concurrent attempts for the same `executeTool` call
- Timeout always aborts before returning `timeout`
- Non-idempotent tools cannot produce duplicate side effects via executor retry
- Logging includes `requestId`, `eventId`, `toolName`, `attempt`, `duration`

### Log sequence (timeout + idempotent retry)

```text
tool execution started
timeout
abort requested
tool cancelled
retry
tool execution started
tool execution completed
```

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
| `timeout` | Exceeded executor timeout (after abort + settle) |
| `execution_failure` | Tool-reported / retryable failure |
| `cancelled` | Parent AbortSignal aborted |
| `unexpected` | Uncaught exception |

## Conversation loop

- Max **3** tool rounds per user turn (`MAX_TOOL_ROUNDS`)
- Each round: LLM → optional tool_calls → execute all → append results → LLM again
- Final turn must be plain text (validated length)

## Source Code References

- `src/lib/tools/router.ts`
- `src/lib/tools/executor.ts`
- `src/lib/ai/conversation.ts`

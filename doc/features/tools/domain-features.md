# Tools — domain features

| Capability | Summary |
|------------|---------|
| Tool Registry | DI-friendly register/get/list/exists; no process globals |
| Tool Router | Validate request → resolve tool → execute → return result |
| Tool Executor | Timeout, retry, logging, duration, cancellation |
| Tool Context | requestId, eventId, userId, slackChannel, metadata |
| Demo tools | `ping`, `current_time`, `current_date` only |
| LLM bridge | OpenAI `tools` / `tool_calls` via Conversation Service |

## Dependencies

- Conversation Service (`src/lib/ai/conversation.ts`)
- OpenAI client (`src/lib/ai/client.ts`) — adapter only; tools stay vendor-agnostic

## Constraints

- No eval, shell, filesystem write, or network from demo tools
- Unknown tools rejected
- Conversation Service must not embed business tool logic

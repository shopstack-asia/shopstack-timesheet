# AI Conversation Architecture

### Overview

Phase 7 adds an OpenAI conversation layer between Slack handlers and Slack responses. Business APIs are not called.

### Diagram

```mermaid
flowchart TB
  Slack --> Disp[Event Dispatcher]
  Disp --> CH[conversation-handler]
  CH --> Conv[conversation.ts]
  Conv --> Prompt[prompt.ts]
  Conv --> Client[OpenAI client]
  Client --> API[Chat Completions]
  Conv --> CH
  CH --> Resp[responses.ts]
  Resp --> Slack
```

### Modules

| Path | Role |
|------|------|
| `src/lib/ai/client.ts` | Config, singleton client, retries, timeouts |
| `src/lib/ai/conversation.ts` | Orchestration + validation + fallback |
| `src/lib/ai/prompt.ts` | System/user message builder |
| `src/lib/ai/errors.ts` | Typed errors + friendly fallback text |
| `src/lib/slack/conversation/conversation-handler.ts` | Slack adapter |

### Configuration

| Env | Default |
|-----|---------|
| `OPENAI_API_KEY` | required when AI enabled |
| `OPENAI_MODEL` | `gpt-4o-mini` |
| `OPENAI_MAX_TOKENS` | `512` |
| `OPENAI_TEMPERATURE` | `0.7` |
| `OPENAI_TIMEOUT_MS` | `30000` |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` |

Aliases: `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` still accepted.

### Future (Phase 8+)

Append tools / policies via `extraSystemSegments` and later tool-calling without rewriting Slack handlers.

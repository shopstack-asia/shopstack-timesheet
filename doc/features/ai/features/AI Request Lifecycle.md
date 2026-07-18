# AI Request Lifecycle

### Sequence

```mermaid
sequenceDiagram
  participant U as User
  participant S as Slack
  participant H as conversation-handler
  participant C as conversation
  participant O as OpenAI client
  participant T as Tool Router

  U->>S: message
  S->>H: event (after ACK)
  H->>C: runConversation(userMessage)
  C->>C: buildPrompt
  C->>O: generateResponse(+ tools)
  alt text only
    O-->>C: text
  else tool_calls
    O-->>C: tool_calls
    C->>T: route each call
    T-->>C: ToolResult
    C->>O: messages + tool results
    O-->>C: final text
  end
  alt success
    C-->>H: validated text
  else timeout / 429 / 5xx / invalid key
    C-->>H: friendly fallback
  end
  H->>S: chat.postMessage
  S-->>U: reply
```

### Retry strategy

Transient failures (`timeout`, `rate_limited`, `server_error`, `network`): up to `maxRetries` (default 2) with exponential backoff starting at 250ms.

Non-retryable: `invalid_api_key`, `invalid_config`, most 4xx.

Tool rounds: max 3 per user turn (`MAX_TOOL_ROUNDS`).

### Error handling

| Failure | User-visible |
|---------|----------------|
| Empty / oversized / OpenAI error | Friendly fallback (no raw SDK text) |
| Unknown / failed tool | Result JSON fed back to model; model answers from that |
| Slack send failure | Logged; Event already ACKed |

### Logging

`conversation started` → `OpenAI request` → (tool lifecycle logs) → `OpenAI response` / failure → `conversation completed`  
Fields: `requestId`, `eventId`, `durationMs`, `model`, `toolRounds`, token usage. Never API keys.

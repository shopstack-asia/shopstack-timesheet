# AI Request Lifecycle

### Sequence

```mermaid
sequenceDiagram
  participant U as User
  participant S as Slack
  participant H as conversation-handler
  participant C as conversation
  participant O as OpenAI client

  U->>S: Hello
  S->>H: event (after ACK)
  H->>C: runConversation(userMessage)
  C->>C: buildPrompt
  C->>O: generateResponse
  alt success
    O-->>C: text + usage
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

### Error handling

| Failure | User-visible |
|---------|----------------|
| Empty / oversized / OpenAI error | Friendly fallback (no raw SDK text) |
| Slack send failure | Logged; Event already ACKed |

### Logging

`conversation started` → `OpenAI request` → `OpenAI response` / failure → `conversation completed`  
Fields: `requestId`, `eventId`, `durationMs`, `model`, token usage. Never API keys.

# Slack Response Flow

### Overview

Lifecycle from user message to bot reply in Foundation Mode.

### Sequence diagram

```mermaid
sequenceDiagram
  participant U as User
  participant S as Slack
  participant R as events/route
  participant D as dispatcher
  participant H as handler
  participant C as responses / Web API

  U->>S: DM or @mention
  S->>R: event_callback (signed)
  R->>R: verify + ACK 200
  R->>D: waitUntil(dispatch)
  D->>D: ignore bot/subtype?
  alt ignored
    D-->>R: handled false
  else DM / mention
    D->>H: handle*
    H->>C: sendMessage / sendThreadReply
    C->>S: chat.postMessage
    S-->>U: bot reply
    Note over H: API errors logged, not thrown to route
  end
```

### DM reply (Foundation Mode)

User: `hello`

Bot:

```text
👋 Hello!

AI Timesheet is connected successfully.

Slack integration is working.

(Currently running Foundation Mode.)
```

### App mention reply

User: `@AI Timesheet hello`

Bot (threaded under the mention when `ts` exists):

```text
Hello <@USER_ID> 👋

Slack integration is working.
```

### Logging checkpoints

1. `message received`  
2. `message dispatched` (dispatcher + handler)  
3. `message sent` / Slack API result (responses)  
4. `message reply complete` or `message reply failed` with duration  

Fields: `requestId`, `eventId`, `channel`, `user`, `durationMs`. Never tokens/secrets.

### Source Code References

- `src/lib/slack/dispatcher.ts`
- `src/lib/slack/responses.ts`
- `src/lib/slack/events/handler-utils.ts`

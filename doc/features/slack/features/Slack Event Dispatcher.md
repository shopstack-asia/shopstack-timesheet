# Slack Event Dispatcher

### Overview

`dispatchSlackEvent` maps Slack `event_callback` envelopes to foundation handlers. Unknown events are ignored safely while the HTTP layer still returns 200.

### Routing table

| Condition | Route |
|-----------|--------|
| `event.bot_id` or `subtype=bot_message` | ignore (`bot`) |
| `SLACK_ALLOWED_WORKSPACE` set and `team_id` differs | ignore (`workspace_mismatch`) |
| `event.type === app_mention` | `handleAppMention` |
| `event.type === message` and (`channel_type === im` or channel `D…`) | `handleDirectMessage` |
| Anything else | ignore (`ignored`) |

### Diagram

```mermaid
flowchart TD
  E[event_callback] --> Bot{bot?}
  Bot -->|yes| I1[ignore]
  Bot -->|no| WS{workspace OK?}
  WS -->|no| I2[ignore]
  WS -->|yes| T{type}
  T -->|app_mention| AM[AppMentionHandler]
  T -->|message.im| DM[DirectMessageHandler]
  T -->|other| I3[ignore safely]
```

### Extensibility

Later phases can:

- Replace log-only handlers with AI conversation entrypoints  
- Add new `case` branches without changing `route.ts`  
- Keep async `waitUntil(dispatch…)` so ACK timing stays stable  

### Handler contract (Phase 4)

Log only:

- Event Type  
- User  
- Channel  
- Text  
- Timestamp  
- Team  

No OpenAI, Redis conversation, or timesheet writes.

### Source Code References

- `src/lib/slack/dispatcher.ts`
- `src/lib/slack/events/app-mention.ts`
- `src/lib/slack/events/direct-message.ts`

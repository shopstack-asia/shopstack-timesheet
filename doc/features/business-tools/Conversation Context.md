# Conversation Context

## Purpose

Ephemeral per-conversation cache for identity, work context, and Client/Project/Role selection.

Never persisted to Redis/DB. TTL default: 30 minutes (in-process).

## Lifecycle

```mermaid
sequenceDiagram
  participant S as Slack
  participant H as conversation-handler
  participant M as Context Manager
  participant T as Business Tool

  S->>H: message
  H->>H: buildConversationId
  H->>T: tool context + conversationId
  T->>M: getConversationContext()
  alt cache miss
    M->>M: resolveEmployee
    opt ensureWorkContext
      M->>M: GET /v1/work-context
    end
    M->>M: store
  else cache hit
    M->>M: reuse
  end
  M-->>T: ConversationContext
```

## Shape

```ts
interface ConversationContext {
  conversationId: string;
  slackUserId: string;
  slackEmail: string;
  employeeId: string;
  workContext?: WorkContext;
  selectedClient?: { id: string; name: string };
  selectedProject?: { id: string; name: string };
  selectedRole?: { id: string; name: string };
  loadedAt: Date;
}
```

## Smart loading

| Option | Behavior |
|--------|----------|
| (default) | Resolve identity if missing; do not load work context |
| `ensureWorkContext: true` | Load work context once if missing |
| `forceRefreshWorkContext: true` | Reload work context; clear selections |

## Invalidation

| Event | Clears |
|-------|--------|
| `selectClient` | selectedProject, selectedRole |
| `selectProject` | selectedRole |
| `forceRefreshWorkContext` | all selections + reloads workContext |

## Security

- Business tools never accept `employeeId` from AI input
- Business tools never call Slack/Zoho identity APIs directly
- Conversation ids include Slack user to isolate concurrent conversations
- Mismatched slackUserId on a cached conversation id forces re-resolve

## Source Code References

- `src/lib/conversation/context/`
- `src/lib/slack/conversation/conversation-handler.ts`

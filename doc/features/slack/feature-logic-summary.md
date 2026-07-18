# Slack — feature logic summary

| Doc | Description |
|-----|-------------|
| [Slack Events Architecture.md](./features/Slack%20Events%20Architecture.md) | Module layout, boundaries, ACK design |
| [Slack Event Lifecycle.md](./features/Slack%20Event%20Lifecycle.md) | Request → verify → parse → dispatch → ACK |
| [Slack Event Dispatcher.md](./features/Slack%20Event%20Dispatcher.md) | Routing table and ignore rules |
| [Slack Response Architecture.md](./features/Slack%20Response%20Architecture.md) | chat.postMessage layer, errors, loop prevention |
| [Slack Response Flow.md](./features/Slack%20Response%20Flow.md) | DM / mention reply lifecycle |

## Related code

- `src/app/api/slack/events/route.ts`
- `src/lib/slack/verifier.ts`
- `src/lib/slack/dispatcher.ts`
- `src/lib/slack/responses.ts`
- `src/lib/slack/events/*`
- `src/lib/slack/types.ts`
- `src/lib/slack/logger.ts`

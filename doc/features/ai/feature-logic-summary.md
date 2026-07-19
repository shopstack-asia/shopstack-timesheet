# AI — feature logic summary

| Doc | Description |
|-----|-------------|
| [AI-First Intent Extraction.md](./features/AI-First%20Intent%20Extraction.md) | Structured NLU → Draft state machine → tools; canonical slot completion (IDs only); target-only merge; general+not_found=general |


| [AI Conversation Architecture.md](./features/AI%20Conversation%20Architecture.md) | Modules and boundaries |
| [AI Prompt Strategy.md](./features/AI%20Prompt%20Strategy.md) | System prompt and extensibility |
| [AI Decision Engine.md](./features/AI%20Decision%20Engine.md) | Legacy regex helpers (not production NL routing) + force-call gate |
| [AI Request Lifecycle.md](./features/AI%20Request%20Lifecycle.md) | Sequence, retries, errors |

## Related code

- `src/lib/ai/intent/*`
- `src/lib/ai/client.ts`
- `src/lib/ai/conversation.ts`
- `src/lib/ai/prompt.ts`
- `src/lib/ai/decision-engine.ts`
- `src/lib/tools/` (tool loop)
- `src/lib/slack/conversation/conversation-handler.ts`

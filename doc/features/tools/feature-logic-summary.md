# Tools — feature logic summary

| Doc | Description |
|-----|-------------|
| [Tool Architecture.md](./features/Tool%20Architecture.md) | Layers, sequence, boundaries |
| [Tool Registry.md](./features/Tool%20Registry.md) | Registration and DI |
| [Tool Execution Lifecycle.md](./features/Tool%20Execution%20Lifecycle.md) | Router → executor → result |
| [MCP Readiness.md](./features/MCP%20Readiness.md) | Future MCP / REST / local adapters |

## Related code

- `src/lib/tools/` — foundation
- `src/lib/ai/conversation.ts` — tool loop
- `src/lib/ai/client.ts` — OpenAI tools adapter

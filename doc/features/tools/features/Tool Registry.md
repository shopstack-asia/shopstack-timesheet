# Tool Registry

## Purpose

Hold registered tools behind a **dependency-injected** interface with no process-global mutable singleton for tool state.

## API

| Method | Behavior |
|--------|----------|
| `register(tool)` | Validates name/description/version/execute; stores by name |
| `get(name)` | Returns tool or undefined |
| `list()` | All tools |
| `exists(name)` | Boolean |
| `toLlmToolDefinitions()` | OpenAI/MCP-compatible function schemas |

## Factory

- `createToolRegistry(initial?)` — empty or seeded
- `createDefaultToolRegistry()` — registers demonstration tools only

## Rules

- Overwrite on re-register of the same name is allowed (last write wins)
- Invalid names throw `ToolError` with `validation_error`
- Conversation injects registry via `RunConversationDeps.toolRegistry`

## Source Code References

- `src/lib/tools/registry.ts`
- `src/lib/tools/index.ts`

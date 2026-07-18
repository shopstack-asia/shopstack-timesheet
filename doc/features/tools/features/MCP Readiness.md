# MCP Readiness

## Goal

Reuse the same Tool / Registry / Router / Executor contracts for:

- OpenAI (and OpenAI-compatible) tool calling — **implemented**
- MCP servers — **future adapter**
- Local in-process tools — **implemented** (builtins)
- Internal REST APIs — **future tool adapters**
- External services — **future**

Conversation Service depends only on `ToolRouter` + `ToolRegistry`, not on MCP or OpenAI SDK packages.

## Adapter sketch (future)

```text
MCP Server tools
  → map MCP tool list → Tool[] (name, description, inputSchema)
  → register into ToolRegistry
  → execute() proxies to MCP call_tool
  → map MCP content → ToolResult
```

No Conversation Service changes required beyond registering an alternate registry/router.

## Non-goals this phase

- Shipping an MCP server or client
- Business domain tools
- Persistent tool permissions / tenant policies (context fields reserved)

## Source Code References

- `src/lib/tools/types.ts` — `LlmToolDefinition`, `Tool`, `ToolResult`
- `src/lib/tools/registry.ts` — `toLlmToolDefinitions()`

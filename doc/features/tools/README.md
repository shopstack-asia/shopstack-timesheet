# Tools — feature area

Vendor-agnostic **Tool Execution Foundation** for AI Timesheet.

## Scope

- Tool interfaces, registry, router, executor, context
- Demonstration tools only: `ping`, `current_time`, `current_date`
- Integration with Conversation Service (OpenAI tool calling loop)
- MCP-ready architecture (no MCP server yet)

## Out of scope (later phases)

- Business tools (timesheet, leave, holiday, employee)
- MCP servers, Redis memory, RAG, workflow engine

## Reading order

1. [domain-features.md](./domain-features.md)
2. [feature-logic-summary.md](./feature-logic-summary.md)
3. [features/Tool Architecture.md](./features/Tool%20Architecture.md)
4. [features/Tool Registry.md](./features/Tool%20Registry.md)
5. [features/Tool Execution Lifecycle.md](./features/Tool%20Execution%20Lifecycle.md)
6. [features/MCP Readiness.md](./features/MCP%20Readiness.md)

## Related areas

- [ai](../ai/) — Conversation Service consumes the tool router
- [slack](../slack/) — Slack → conversation → tools → Slack

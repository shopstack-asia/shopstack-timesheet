# Business — feature area

Reusable **Business API Client** for AI Business Tools to call internal CS-Core REST APIs.

## Scope

- `src/lib/business/*` — config, auth, client, errors, logging
- No Timesheet / Leave / Holiday / Employee tools in this phase

## Out of scope

Business tools, workflows, memory, RAG, database changes.

## Reading order

1. [domain-features.md](./domain-features.md)
2. [feature-logic-summary.md](./feature-logic-summary.md)
3. [features/Business API Foundation.md](./features/Business%20API%20Foundation.md)
4. [features/Authentication.md](./features/Authentication.md)
5. [features/Request Lifecycle.md](./features/Request%20Lifecycle.md)
6. [features/Error Handling.md](./features/Error%20Handling.md)

## Related

- Tools: [../tools/](../tools/) — Business Tools will call this client from `execute()`
- AI: [../ai/](../ai/) — Conversation remains tool-agnostic
- Env: [../ops/features/environment-variables.md](../ops/features/environment-variables.md)

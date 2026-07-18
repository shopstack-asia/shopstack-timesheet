# AI — feature area

## Purpose

OpenAI conversation foundation for Slack: prompt build → chat completion → optional **tool loop** → validated plain-text reply.

## Scope

- `src/lib/ai/*` — client, conversation, prompt, types, errors
- Slack adapter: `src/lib/slack/conversation/conversation-handler.ts`
- Tool loop uses [../tools/](../tools/) (demonstration tools only)

## Out of scope

Business tools (timesheet/leave/holiday), Redis memory, RAG, embeddings, LangChain.

## Reading order

1. This README  
2. [domain-features.md](./domain-features.md)  
3. [feature-logic-summary.md](./feature-logic-summary.md)  
4. [features/](./features/)  
5. Code  

## Related

- Tools foundation: [../tools/](../tools/)
- Slack events/responses: [../slack/](../slack/)
- Env: [../ops/features/environment-variables.md](../ops/features/environment-variables.md)

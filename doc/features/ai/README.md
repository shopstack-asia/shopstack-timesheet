# AI — feature area

## Purpose

OpenAI conversation foundation for Slack: prompt build → chat completion → validated plain-text reply. No tools, memory, or business APIs.

## Scope

- `src/lib/ai/*` — client, conversation, prompt, types, errors
- Slack adapter: `src/lib/slack/conversation/conversation-handler.ts`

## Out of scope

Tool calling, timesheet/leave APIs, Redis memory, RAG, embeddings, LangChain.

## Reading order

1. This README  
2. [domain-features.md](./domain-features.md)  
3. [feature-logic-summary.md](./feature-logic-summary.md)  
4. [features/](./features/)  
5. Code  

## Related

- Slack events/responses: [../slack/](../slack/)
- Env: [../ops/features/environment-variables.md](../ops/features/environment-variables.md)

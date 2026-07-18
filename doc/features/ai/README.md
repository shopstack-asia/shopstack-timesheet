# AI — feature area

## Purpose

OpenAI conversation for Slack: decision engine → prompt → chat completion → **tool loop** (forced for business intents) → validated plain-text reply.

## Scope

- `src/lib/ai/*` — client, conversation, prompt, decision engine, types, errors
- Slack adapter: `src/lib/slack/conversation/conversation-handler.ts`
- Tool loop uses [../tools/](../tools/) + [../business-tools/](../business-tools/)

## Out of scope

Write tools, Redis memory, RAG, embeddings, LangChain.

## Reading order

1. This README  
2. [domain-features.md](./domain-features.md)  
3. [feature-logic-summary.md](./feature-logic-summary.md)  
4. [features/](./features/)  
5. Code  

## Related

- Tools foundation: [../tools/](../tools/)
- Business tools: [../business-tools/](../business-tools/)
- Slack events/responses: [../slack/](../slack/)
- Env: [../ops/features/environment-variables.md](../ops/features/environment-variables.md)

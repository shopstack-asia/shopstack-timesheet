# AI — domain features

| Capability | Behavior |
|------------|----------|
| Config | `OPENAI_API_KEY` (+ model/tokens/temperature/timeout); startup validation when key present |
| Prompt | Foundation system prompt + user message; tool-aware phase copy |
| Generate | Chat Completions via HTTP; optional `tools`; timeout; retries on 429/5xx/network |
| Conversation | Build prompt → OpenAI → tool router (if tool_calls) → OpenAI → validate → plain text (or friendly fallback) |
| Slack bridge | DM / app_mention → conversation → `chat.postMessage` |

## Constraints

- Never log API keys  
- Never expose raw OpenAI errors to Slack users  
- Business tools live in later phases; see [../tools/](../tools/) for framework  

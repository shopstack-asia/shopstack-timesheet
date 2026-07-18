# AI — domain features

| Capability | Behavior |
|------------|----------|
| Config | `OPENAI_API_KEY` (+ model/tokens/temperature/timeout); startup validation when key present |
| Prompt | Foundation system prompt + user message; extensible segments later |
| Generate | Chat Completions via HTTP; timeout; retries on 429/5xx/network |
| Conversation | Build prompt → OpenAI → validate → plain text (or friendly fallback) |
| Slack bridge | DM / app_mention → conversation → `chat.postMessage` |

## Constraints

- Never log API keys  
- Never expose raw OpenAI errors to Slack users  
- No tool calling / business APIs in this phase  

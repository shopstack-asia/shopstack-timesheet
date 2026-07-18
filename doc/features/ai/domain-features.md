# AI — domain features

| Capability | Behavior |
|------------|----------|
| Config | `OPENAI_API_KEY` (+ model/tokens/temperature/timeout); startup validation when key present |
| Prompt | Reliability system prompt + user message; Business Tools as source of truth |
| Decision engine | General questions answer directly; employee-business → Business Tool or clarify; standalone today/วันนี้ → `get_timesheet`; exact-tool round-0 enforcement |
| Generate | Chat Completions via HTTP; optional `tools`; timeout; retries on 429/5xx/network |
| Conversation | Decide → prompt → OpenAI → tool router (forced if needed) → OpenAI → validate → plain text |
| Slack bridge | DM / app_mention → conversation → `chat.postMessage` |

## Constraints

- Never log API keys  
- Never answer business data from model knowledge  
- Never claim “cannot access” without executing a Business Tool  
- Tool failures must surface the real error reason to the user (via model, from tool result)  
- See [../tools/](../tools/) and [../business-tools/](../business-tools/)

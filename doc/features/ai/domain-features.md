# AI — domain features

| Capability | Behavior |
|------------|----------|
| Config | `OPENAI_API_KEY` (+ model/tokens/temperature/timeout); `AI_INTENT_EXTRACTION_ENABLED` for AI-first NLU; startup validation when key present |
| Prompt | Reliability + Slack Response Style (mrkdwn, compact timesheet, Task≠Role); Business Tools as source of truth |
| Intent extraction | When flag on: structured JSON intent → deterministic enforce (dates, masters, tool map, drafts). Regex Decision Engine is fallback / flag-off |
| Decision engine | Bare confirm/cancel + ISO/range safety stay deterministic; exact-tool round-0 enforcement |
| Generate | Chat Completions via HTTP; optional `tools` / `response_format: json_object` for extraction; timeout; retries on 429/5xx/network |
| Conversation | Decide (AI-first or regex) → prompt → OpenAI → tool router (forced if needed) → OpenAI → validate → plain text |
| Slack bridge | DM / app_mention → conversation → `chat.postMessage` |

## Constraints

- Never log API keys  
- Never answer business data from model knowledge  
- Never claim “cannot access” without executing a Business Tool  
- Tool failures must surface the real error reason to the user (via model, from tool result)  
- Incomplete Timesheet asks clarify — do not treat as general conversation  
- See [../tools/](../tools/) and [../business-tools/](../business-tools/)

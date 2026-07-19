# Slack — domain features

## Capabilities

| Capability | Behavior |
|------------|----------|
| URL verification | Responds to Slack `url_verification` with `{ challenge }` and HTTP 200 |
| Request auth | Verifies `x-slack-signature` + timestamp; rejects missing/invalid/replayed requests with 401 |
| Rate limit | Fail-closed Redis rate limit on the events route |
| Event callback | Parses envelope (`team_id`, `event_id`, `event`, …) and dispatches asynchronously |
| Direct message | `message` + IM → Conversation Service → OpenAI → Slack reply |
| App mention | `@bot` → Conversation Service → OpenAI → threaded Slack reply |
| App Home | `app_home_opened` (tab=home) → Conversation Context + canonical reads → `views.publish` (no OpenAI, no writes) |
| App Home actions | Refresh / Help / Retry via interactions; URL button for Weekly Timesheet |
| Bot loop prevention | Ignore `bot_id`, `bot_message`, other subtypes, missing user (message path) |
| Unknown events | Ignored; still ACK 200 |
| ACK SLA | Verify → parse → schedule dispatch → return 200 without awaiting heavy work |

## Dependencies

- `SLACK_SIGNING_SECRET` (required for verification)
- `SLACK_BOT_TOKEN` (required to send replies and publish Home)
- Optional `SLACK_ALLOWED_WORKSPACE` to ignore other teams
- Optional `SLACK_ENABLE_APP_HOME` (default true)
- `NEXT_PUBLIC_APP_URL` / `APP_URL` / `NEXTAUTH_URL` for safe Weekly Timesheet link
- Redis for rate limiting and event/action dedupe (fail-closed on rate limit)

## Constraints

- Secrets never logged or exposed to the browser
- Route stays thin; business logic must not live in `route.ts`
- Response handlers catch Web API errors so Event ACK is never compromised
- App Home must not accept employee identity from Block Kit values or `private_metadata`
- Conversation Context is the only employee identity source for Home data

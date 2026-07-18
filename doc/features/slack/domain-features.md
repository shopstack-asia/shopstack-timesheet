# Slack — domain features

## Capabilities

| Capability | Behavior |
|------------|----------|
| URL verification | Responds to Slack `url_verification` with `{ challenge }` and HTTP 200 |
| Request auth | Verifies `x-slack-signature` + timestamp; rejects missing/invalid/replayed requests with 401 |
| Rate limit | Fail-closed Redis rate limit on the events route |
| Event callback | Parses envelope (`team_id`, `event_id`, `event`, …) and dispatches asynchronously |
| App mention | Foundation reply via `chat.postMessage` (threaded); no AI |
| Direct message | Foundation connectivity reply via `chat.postMessage`; no AI |
| Bot loop prevention | Ignore `bot_id`, `bot_message`, other subtypes, missing user |
| Unknown events | Ignored; still ACK 200 |
| ACK SLA | Verify → parse → schedule dispatch → return 200 without awaiting heavy work |

## Dependencies

- `SLACK_SIGNING_SECRET` (required for verification)
- `SLACK_BOT_TOKEN` (required to send replies)
- Optional `SLACK_ALLOWED_WORKSPACE` to ignore other teams
- Redis for rate limiting (fail-closed)

## Constraints

- Secrets never logged or exposed to the browser
- Route stays thin; business logic must not live in `route.ts`
- Response handlers catch Web API errors so Event ACK is never compromised
- Existing Timesheet AI agent (`event-handler.ts`) remains unwired in foundation phases

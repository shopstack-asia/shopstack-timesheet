# 04 — Slack Setup

## Create Slack app

1. api.slack.com → Create app  
2. Bot token scopes:
   - `app_mentions:read`
   - `chat:write`
   - `im:history`
   - `im:read`
   - `im:write`
   - `users:read`
   - `users:read.email`
3. Event Subscriptions → Request URL: `https://<your-domain>/api/slack/events`  
   Subscribe: `app_mention`, `message.im`  
4. Interactivity → `https://<your-domain>/api/slack/interactions`  
5. Install app; copy Bot User OAuth Token → `SLACK_BOT_TOKEN`  
6. Basic Information → Signing Secret → `SLACK_SIGNING_SECRET`

## Usage

- DM the bot, or `@Bot` in a channel  
- Multi-step flows reply in a **thread**  

## Notes

- Email must be visible to the bot for identity  
- URL verification is handled automatically by the events route

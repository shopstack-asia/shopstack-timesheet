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
   Subscribe: `app_mention`, `message.im`, `app_home_opened`  
4. App Home → enable **Home Tab** (Messages Tab remains on for DMs)  
5. Interactivity → `https://<your-domain>/api/slack/interactions`  
6. Install app; copy Bot User OAuth Token → `SLACK_BOT_TOKEN`  
7. Basic Information → Signing Secret → `SLACK_SIGNING_SECRET`

## Usage

- DM the bot, or `@Bot` in a channel  
- Open the app **Home** tab for the read-only Timesheet dashboard  
- Multi-step write flows reply in a **thread** and still require confirmation  

## Notes

- Email must be visible to the bot for identity  
- URL verification is handled automatically by the events route  
- App Home does not call OpenAI and does not write Timesheet data  
- Set **`SLACK_ALLOWED_WORKSPACE`** to your exact Slack Team ID (e.g. `T012ABCDEF`) so App Home events and Block Kit actions from other workspaces are ignored  
- Detailed Home docs: `doc/features/slack/features/Slack App Home.md`

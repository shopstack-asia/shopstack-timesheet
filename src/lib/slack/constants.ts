/** Slack Events foundation constants (no secrets). */

/** Reject requests whose timestamp is older/newer than this window (seconds). */
export const SLACK_REPLAY_WINDOW_SECONDS = 60 * 5;

export const SLACK_SIGNATURE_VERSION = 'v0';

export const SLACK_HEADER_SIGNATURE = 'x-slack-signature';
export const SLACK_HEADER_TIMESTAMP = 'x-slack-request-timestamp';

export const PAYLOAD_URL_VERIFICATION = 'url_verification';
export const PAYLOAD_EVENT_CALLBACK = 'event_callback';

export const EVENT_APP_MENTION = 'app_mention';
export const EVENT_MESSAGE = 'message';
export { EVENT_APP_HOME_OPENED } from '@/lib/slack/app-home/constants';

export const CHANNEL_TYPE_IM = 'im';
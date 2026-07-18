/**
 * Typed Slack Events API models for the foundation gateway.
 * Avoid `any` — keep payloads narrow and extensible.
 */

export interface SlackUrlVerification {
  type: 'url_verification';
  token?: string;
  challenge: string;
}

export interface SlackAuthorization {
  enterprise_id?: string | null;
  team_id?: string | null;
  user_id?: string | null;
  is_bot?: boolean;
  is_enterprise_install?: boolean;
}

/** Common fields on Slack event objects we care about. */
export interface SlackEventBase {
  type: string;
  user?: string;
  channel?: string;
  channel_type?: string;
  text?: string;
  ts?: string;
  event_ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  team?: string;
  client_msg_id?: string;
}

export interface SlackAppMention extends SlackEventBase {
  type: 'app_mention';
  user: string;
  channel: string;
  text: string;
}

export interface SlackDirectMessage extends SlackEventBase {
  type: 'message';
  channel_type: 'im';
  user: string;
  channel: string;
  text?: string;
}

export type SlackEvent = SlackEventBase;

export interface SlackEventEnvelope {
  type: 'event_callback';
  token?: string;
  team_id?: string;
  api_app_id?: string;
  event: SlackEvent;
  event_id?: string;
  event_time?: number;
  authorizations?: SlackAuthorization[];
  is_ext_shared_channel?: boolean;
  event_context?: string;
}

export type SlackEventsPayload = SlackUrlVerification | SlackEventEnvelope;

export type SlackVerificationResult =
  | { ok: true }
  | { ok: false; reason: 'missing_headers' | 'missing_secret' | 'replay' | 'bad_signature' };

export type ParseEventsPayloadResult =
  | { ok: true; payload: SlackEventsPayload }
  | { ok: false; reason: 'invalid_json' | 'unsupported_payload' };

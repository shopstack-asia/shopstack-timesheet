import {
  PAYLOAD_EVENT_CALLBACK,
  PAYLOAD_URL_VERIFICATION,
} from '@/lib/slack/constants';
import type {
  ParseEventsPayloadResult,
  SlackEventEnvelope,
  SlackEventsPayload,
  SlackUrlVerification,
} from '@/lib/slack/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and narrow Slack Events API JSON body.
 * Does not verify signatures — caller must verify first.
 */
export function parseSlackEventsPayload(rawBody: string): ParseEventsPayloadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return { ok: false, reason: 'unsupported_payload' };
  }

  if (parsed.type === PAYLOAD_URL_VERIFICATION) {
    if (typeof parsed.challenge !== 'string' || !parsed.challenge) {
      return { ok: false, reason: 'unsupported_payload' };
    }
    const payload: SlackUrlVerification = {
      type: 'url_verification',
      challenge: parsed.challenge,
      token: typeof parsed.token === 'string' ? parsed.token : undefined,
    };
    return { ok: true, payload };
  }

  if (parsed.type === PAYLOAD_EVENT_CALLBACK) {
    if (!isRecord(parsed.event) || typeof parsed.event.type !== 'string') {
      return { ok: false, reason: 'unsupported_payload' };
    }
    const payload: SlackEventEnvelope = {
      type: 'event_callback',
      token: typeof parsed.token === 'string' ? parsed.token : undefined,
      team_id: typeof parsed.team_id === 'string' ? parsed.team_id : undefined,
      api_app_id:
        typeof parsed.api_app_id === 'string' ? parsed.api_app_id : undefined,
      event: {
        type: parsed.event.type,
        user: typeof parsed.event.user === 'string' ? parsed.event.user : undefined,
        channel:
          typeof parsed.event.channel === 'string'
            ? parsed.event.channel
            : undefined,
        channel_type:
          typeof parsed.event.channel_type === 'string'
            ? parsed.event.channel_type
            : undefined,
        text: typeof parsed.event.text === 'string' ? parsed.event.text : undefined,
        ts: typeof parsed.event.ts === 'string' ? parsed.event.ts : undefined,
        event_ts:
          typeof parsed.event.event_ts === 'string'
            ? parsed.event.event_ts
            : undefined,
        thread_ts:
          typeof parsed.event.thread_ts === 'string'
            ? parsed.event.thread_ts
            : undefined,
        bot_id:
          typeof parsed.event.bot_id === 'string' ? parsed.event.bot_id : undefined,
        subtype:
          typeof parsed.event.subtype === 'string'
            ? parsed.event.subtype
            : undefined,
        team: typeof parsed.event.team === 'string' ? parsed.event.team : undefined,
        client_msg_id:
          typeof parsed.event.client_msg_id === 'string'
            ? parsed.event.client_msg_id
            : undefined,
      },
      event_id: typeof parsed.event_id === 'string' ? parsed.event_id : undefined,
      event_time:
        typeof parsed.event_time === 'number' ? parsed.event_time : undefined,
      authorizations: Array.isArray(parsed.authorizations)
        ? (parsed.authorizations as SlackEventEnvelope['authorizations'])
        : undefined,
    };
    return { ok: true, payload };
  }

  return { ok: false, reason: 'unsupported_payload' };
}

export function isUrlVerification(
  payload: SlackEventsPayload
): payload is SlackUrlVerification {
  return payload.type === 'url_verification';
}

export function isEventCallback(
  payload: SlackEventsPayload
): payload is SlackEventEnvelope {
  return payload.type === 'event_callback';
}

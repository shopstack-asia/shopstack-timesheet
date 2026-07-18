import {
  CHANNEL_TYPE_IM,
  EVENT_APP_MENTION,
  EVENT_MESSAGE,
} from '@/lib/slack/constants';
import { handleAppMention } from '@/lib/slack/events/app-mention';
import { handleDirectMessage } from '@/lib/slack/events/direct-message';
import { shouldIgnoreSlackMessage } from '@/lib/slack/events/handler-utils';
import { createSlackRequestLogger } from '@/lib/slack/logger';
import type { SlackPostMessageClient } from '@/lib/slack/responses';
import type { SlackEventEnvelope } from '@/lib/slack/types';

export type DispatchResult =
  | { handled: true; route: 'app_mention' | 'message.im' }
  | { handled: false; route: 'ignored' | 'bot' | 'workspace_mismatch' };

export type DispatchOptions = {
  requestId: string;
  /** When set, reject events from other workspaces */
  allowedWorkspace?: string;
  /** Injected Slack client for tests */
  client?: SlackPostMessageClient;
};

function isDirectMessage(envelope: SlackEventEnvelope): boolean {
  const event = envelope.event;
  if (event.type !== EVENT_MESSAGE) return false;
  if (event.channel_type === CHANNEL_TYPE_IM) return true;
  return Boolean(event.channel?.startsWith('D'));
}

/**
 * Route Slack event_callback envelopes to foundation handlers.
 * Unknown events are ignored safely (caller still ACKs 200).
 * Designed for async invocation (e.g. waitUntil) without blocking ACK.
 */
export async function dispatchSlackEvent(
  envelope: SlackEventEnvelope,
  options: DispatchOptions
): Promise<DispatchResult> {
  const log = createSlackRequestLogger({
    requestId: options.requestId,
    eventId: envelope.event_id,
    eventType: envelope.event?.type,
    team: envelope.team_id,
  });

  log.info('message dispatched', {
    channel: envelope.event?.channel,
    user: envelope.event?.user,
  });

  if (
    options.allowedWorkspace &&
    envelope.team_id &&
    envelope.team_id !== options.allowedWorkspace
  ) {
    log.warn('workspace mismatch — ignoring event', {
      team: envelope.team_id,
      allowedWorkspace: options.allowedWorkspace,
    });
    return { handled: false, route: 'workspace_mismatch' };
  }

  if (!envelope.event || typeof envelope.event.type !== 'string') {
    log.info('missing event — ignored');
    return { handled: false, route: 'ignored' };
  }

  if (shouldIgnoreSlackMessage(envelope.event)) {
    log.debug('bot/subtype event — ignored');
    return { handled: false, route: 'bot' };
  }

  const eventType = envelope.event.type;
  const handlerDeps = { client: options.client };

  if (eventType === EVENT_APP_MENTION) {
    await handleAppMention(
      { requestId: options.requestId, envelope },
      handlerDeps
    );
    return { handled: true, route: 'app_mention' };
  }

  if (isDirectMessage(envelope)) {
    await handleDirectMessage(
      { requestId: options.requestId, envelope },
      handlerDeps
    );
    return { handled: true, route: 'message.im' };
  }

  log.info('unknown event — ignored', { eventType });
  return { handled: false, route: 'ignored' };
}

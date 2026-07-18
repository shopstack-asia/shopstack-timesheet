import {
  FOUNDATION_DM_REPLY,
  shouldIgnoreSlackMessage,
  type EventHandlerContext,
} from '@/lib/slack/events/handler-utils';
import { createSlackRequestLogger } from '@/lib/slack/logger';
import { sendMessage, type SlackPostMessageClient } from '@/lib/slack/responses';

export type { EventHandlerContext };

export type DirectMessageHandlerDeps = {
  client?: SlackPostMessageClient;
};

/**
 * Foundation DM handler: reply with connectivity confirmation.
 * No AI / business logic. Errors are logged; never rethrown (ACK already sent).
 */
export async function handleDirectMessage(
  ctx: EventHandlerContext,
  deps?: DirectMessageHandlerDeps
): Promise<void> {
  const started = Date.now();
  const event = ctx.envelope.event;
  const log = createSlackRequestLogger({
    requestId: ctx.requestId,
    eventId: ctx.envelope.event_id,
    handler: 'message.im',
    user: event.user,
    channel: event.channel,
  });

  log.info('message received', {
    eventType: event.type,
    text: event.text,
    timestamp: event.ts || event.event_ts,
    team: ctx.envelope.team_id || event.team,
  });

  if (shouldIgnoreSlackMessage(event)) {
    log.info('message ignored (bot/subtype/loop prevention)');
    return;
  }

  const channel = event.channel;
  if (!channel) {
    log.warn('message ignored — missing channel');
    return;
  }

  log.info('message dispatched');

  try {
    await sendMessage(channel, FOUNDATION_DM_REPLY, {
      requestId: ctx.requestId,
      eventId: ctx.envelope.event_id,
      client: deps?.client,
    });
    log.info('message reply complete', {
      durationMs: Date.now() - started,
    });
  } catch (error) {
    log.error('message reply failed', {
      durationMs: Date.now() - started,
      errorCode:
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'unknown',
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

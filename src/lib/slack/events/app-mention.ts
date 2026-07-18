import {
  foundationMentionReply,
  shouldIgnoreSlackMessage,
  type EventHandlerContext,
} from '@/lib/slack/events/handler-utils';
import { createSlackRequestLogger } from '@/lib/slack/logger';
import {
  sendMessage,
  sendThreadReply,
  type SlackPostMessageClient,
} from '@/lib/slack/responses';

export type { EventHandlerContext };

export type AppMentionHandlerDeps = {
  client?: SlackPostMessageClient;
};

/**
 * Foundation app_mention handler: greet the mentioning user.
 * No AI / business logic. Errors are logged; never rethrown (ACK already sent).
 */
export async function handleAppMention(
  ctx: EventHandlerContext,
  deps?: AppMentionHandlerDeps
): Promise<void> {
  const started = Date.now();
  const event = ctx.envelope.event;
  const log = createSlackRequestLogger({
    requestId: ctx.requestId,
    eventId: ctx.envelope.event_id,
    handler: 'app_mention',
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
  const userId = event.user;
  if (!channel || !userId) {
    log.warn('message ignored — missing channel or user');
    return;
  }

  const text = foundationMentionReply(userId);
  const threadTs = event.thread_ts || event.ts;
  const sendOpts = {
    requestId: ctx.requestId,
    eventId: ctx.envelope.event_id,
    client: deps?.client,
  };

  log.info('message dispatched');

  try {
    if (threadTs) {
      await sendThreadReply(channel, threadTs, text, sendOpts);
    } else {
      await sendMessage(channel, text, sendOpts);
    }
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

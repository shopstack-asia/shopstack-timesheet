import { runConversation, type RunConversationDeps } from '@/lib/ai/conversation';
import { buildConversationId } from '@/lib/conversation/context';
import type { EventHandlerContext } from '@/lib/slack/events/handler-utils';
import { shouldIgnoreSlackMessage } from '@/lib/slack/events/handler-utils';
import { createSlackRequestLogger } from '@/lib/slack/logger';
import {
  sendMessage,
  sendThreadReply,
  type SlackPostMessageClient,
} from '@/lib/slack/responses';

export type ConversationHandlerDeps = RunConversationDeps & {
  slackClient?: SlackPostMessageClient;
};

function stripBotMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/gi, '').trim();
}

/**
 * Slack → Conversation Service → Slack reply.
 * Thin adapter: no business logic, no OpenAI SDK usage here.
 */
export async function handleSlackConversation(
  ctx: EventHandlerContext,
  mode: 'dm' | 'app_mention',
  deps?: ConversationHandlerDeps
): Promise<void> {
  const started = Date.now();
  const event = ctx.envelope.event;
  const log = createSlackRequestLogger({
    requestId: ctx.requestId,
    eventId: ctx.envelope.event_id,
    handler: mode === 'dm' ? 'message.im' : 'app_mention',
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

  const userMessage = stripBotMention(event.text || '');
  if (!userMessage) {
    log.info('message ignored — empty text after mention strip');
    return;
  }

  log.info('message dispatched');

  const threadTs =
    mode === 'app_mention' ? event.thread_ts || event.ts : undefined;
  const conversationId = buildConversationId({
    channel,
    threadTs,
    slackUserId: userId,
  });

  try {
    const result = await runConversation(
      {
        userMessage,
        requestId: ctx.requestId,
        eventId: ctx.envelope.event_id,
        conversationId,
        metadata: {
          slackUserId: userId,
          channel,
          mode,
          conversationId,
        },
      },
      { generate: deps?.generate }
    );

    const sendOpts = {
      requestId: ctx.requestId,
      eventId: ctx.envelope.event_id,
      client: deps?.slackClient,
    };

    if (threadTs) {
      await sendThreadReply(channel, threadTs, result.text, sendOpts);
    } else {
      await sendMessage(channel, result.text, sendOpts);
    }

    log.info('message reply complete', {
      durationMs: Date.now() - started,
      usedFallback: result.usedFallback,
      model: result.model,
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

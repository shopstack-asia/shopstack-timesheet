import type { SlackEventEnvelope } from '@/lib/slack/types';
import { createSlackRequestLogger } from '@/lib/slack/logger';

export type EventHandlerContext = {
  requestId: string;
  envelope: SlackEventEnvelope;
};

/** Foundation handler: log only — no AI / business logic. */
export async function handleDirectMessage(
  ctx: EventHandlerContext
): Promise<void> {
  const event = ctx.envelope.event;
  const log = createSlackRequestLogger({
    requestId: ctx.requestId,
    eventId: ctx.envelope.event_id,
    handler: 'message.im',
  });

  log.info('direct_message received', {
    eventType: event.type,
    user: event.user,
    channel: event.channel,
    text: event.text,
    timestamp: event.ts || event.event_ts,
    team: ctx.envelope.team_id || event.team,
  });
}

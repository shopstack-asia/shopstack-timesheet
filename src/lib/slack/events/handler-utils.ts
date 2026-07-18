import type { SlackEvent, SlackEventEnvelope } from '@/lib/slack/types';

export type EventHandlerContext = {
  requestId: string;
  envelope: SlackEventEnvelope;
};

/**
 * Ignore bot-authored / echoed messages to prevent reply loops.
 * Safe to call from dispatcher and handlers (defense in depth).
 */
export function shouldIgnoreSlackMessage(event: SlackEvent | undefined): boolean {
  if (!event) return true;
  if (event.bot_id) return true;
  if (event.subtype === 'bot_message') return true;
  // Any other subtype (message_changed, file_share, …) is unsupported in foundation mode
  if (event.subtype) return true;
  // No human user → not a user DM/mention we should answer
  if (!event.user) return true;
  return false;
}

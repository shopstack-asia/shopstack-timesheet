import type { EventHandlerContext } from '@/lib/slack/events/handler-utils';
import {
  handleSlackConversation,
  type ConversationHandlerDeps,
} from '@/lib/slack/conversation/conversation-handler';
import type { SlackPostMessageClient } from '@/lib/slack/responses';

export type { EventHandlerContext };

export type DirectMessageHandlerDeps = ConversationHandlerDeps & {
  client?: SlackPostMessageClient;
};

/** DM handler — delegates to Conversation Service (OpenAI foundation). */
export async function handleDirectMessage(
  ctx: EventHandlerContext,
  deps?: DirectMessageHandlerDeps
): Promise<void> {
  const { client, ...rest } = deps ?? {};
  await handleSlackConversation(ctx, 'dm', {
    ...rest,
    slackClient: client ?? deps?.slackClient,
  });
}

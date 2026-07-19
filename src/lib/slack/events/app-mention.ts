import type { EventHandlerContext } from '@/lib/slack/events/handler-utils';
import {
  handleSlackConversation,
  type ConversationHandlerDeps,
} from '@/lib/slack/conversation/conversation-handler';
import type { SlackPostMessageClient } from '@/lib/slack/responses';

export type { EventHandlerContext };

export type AppMentionHandlerDeps = ConversationHandlerDeps & {
  client?: SlackPostMessageClient;
};

/** App mention handler — delegates to Conversation Service (OpenAI foundation). */
export async function handleAppMention(
  ctx: EventHandlerContext,
  deps?: AppMentionHandlerDeps
): Promise<void> {
  const { client, ...rest } = deps ?? {};
  await handleSlackConversation(ctx, 'app_mention', {
    ...rest,
    slackClient: client ?? deps?.slackClient,
  });
}

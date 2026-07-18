import { resolveSlackIdentity } from '@/lib/slack/identity';
import { postSlackMessage } from '@/lib/slack/client';
import { handleAgentMessage } from '@/lib/timesheet-agent/agent';
import { wasEventProcessed } from '@/lib/timesheet-agent/conversation-state';

function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/gi, '').trim();
}

export async function processSlackEvent(event: {
  type?: string;
  user?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  event_ts?: string;
  client_msg_id?: string;
}): Promise<void> {
  if (!event || event.bot_id || event.subtype === 'bot_message') {
    return;
  }
  if (event.type !== 'message' && event.type !== 'app_mention') {
    return;
  }
  // Ignore message edits / joins
  if (event.subtype && event.subtype !== 'file_share') {
    return;
  }

  const dedupeId =
    event.client_msg_id ||
    event.event_ts ||
    `${event.channel}:${event.ts}:${event.user}`;
  if (await wasEventProcessed(dedupeId)) {
    return;
  }

  const userId = event.user;
  const channel = event.channel;
  const text = stripMention(event.text || '');
  if (!userId || !channel || !text) {
    return;
  }

  // Thread: use existing thread or start one from message ts
  const threadTs = event.thread_ts || event.ts;
  if (!threadTs) return;

  const identity = await resolveSlackIdentity(userId);
  if (!identity.ok) {
    await postSlackMessage({
      channel,
      threadTs,
      text: identity.message,
    });
    return;
  }

  try {
    const result = await handleAgentMessage({
      text,
      slackUserId: userId,
      channelId: channel,
      threadTs,
      auth: identity.auth,
    });
    await postSlackMessage({
      channel,
      threadTs,
      text: result.text,
    });
  } catch (error) {
    console.error('[SlackEvent] agent error', error);
    await postSlackMessage({
      channel,
      threadTs,
      text: 'Something went wrong processing your request. Please try again.',
    });
  }
}

export async function processSlackInteraction(payload: {
  type?: string;
  user?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string; thread_ts?: string };
  container?: { thread_ts?: string; message_ts?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
  trigger_id?: string;
}): Promise<void> {
  const userId = payload.user?.id;
  const channel = payload.channel?.id;
  const threadTs =
    payload.message?.thread_ts ||
    payload.container?.thread_ts ||
    payload.message?.ts ||
    payload.container?.message_ts;
  const action = payload.actions?.[0];
  if (!userId || !channel || !threadTs || !action) return;

  const text =
    action.action_id === 'timesheet_confirm'
      ? 'YES'
      : action.action_id === 'timesheet_cancel'
        ? 'CANCEL'
        : action.value || '';

  if (!text) return;

  const identity = await resolveSlackIdentity(userId);
  if (!identity.ok) {
    await postSlackMessage({ channel, threadTs, text: identity.message });
    return;
  }

  const result = await handleAgentMessage({
    text,
    slackUserId: userId,
    channelId: channel,
    threadTs,
    auth: identity.auth,
  });
  await postSlackMessage({ channel, threadTs, text: result.text });
}

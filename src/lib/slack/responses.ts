import { WebClient } from '@slack/web-api';
import { getSlackClient } from '@/lib/slack/client';
import { createSlackRequestLogger, type SlackLogFields } from '@/lib/slack/logger';
import { normalizeSlackMrkdwn } from '@/lib/slack/mrkdwn';

export class SlackResponseError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'SlackResponseError';
    this.code = code;
  }
}

export type SlackPostMessageClient = Pick<WebClient, 'chat'>;

export type SendMessageOptions = {
  requestId?: string;
  eventId?: string;
  /** Injected client for tests — never log tokens */
  client?: SlackPostMessageClient;
};

function assertNonEmpty(name: string, value: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new SlackResponseError(
      `${name} is required`,
      'invalid_argument'
    );
  }
  return trimmed;
}

function resolveClient(client?: SlackPostMessageClient): SlackPostMessageClient {
  return client ?? getSlackClient();
}

async function postMessage(params: {
  channel: string;
  text: string;
  threadTs?: string;
  options?: SendMessageOptions;
}): Promise<{ ts?: string }> {
  const channel = assertNonEmpty('channel', params.channel);
  const text = assertNonEmpty('text', normalizeSlackMrkdwn(params.text));
  const log = createSlackRequestLogger({
    requestId: params.options?.requestId,
    eventId: params.options?.eventId,
    channel,
    action: 'chat.postMessage',
  });

  const started = Date.now();
  try {
    const slack = resolveClient(params.options?.client);
    const result = await slack.chat.postMessage({
      channel,
      text,
      thread_ts: params.threadTs,
      mrkdwn: true,
    });

    if (!result.ok) {
      const code = result.error || 'slack_api_error';
      log.error('Slack API postMessage failed', {
        errorCode: code,
        durationMs: Date.now() - started,
      });
      throw new SlackResponseError(
        `Slack chat.postMessage failed: ${code}`,
        code
      );
    }

    log.info('message sent', {
      durationMs: Date.now() - started,
      messageTs: result.ts,
      threaded: Boolean(params.threadTs),
    });

    return { ts: result.ts };
  } catch (error) {
    if (error instanceof SlackResponseError) {
      throw error;
    }
    const fields: SlackLogFields = {
      errorCode: 'exception',
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'unknown',
    };
    log.error('Slack API postMessage exception', fields);
    throw new SlackResponseError(
      error instanceof Error ? error.message : 'Slack API exception',
      'exception'
    );
  }
}

/** Send a top-level channel / DM message via chat.postMessage. */
export async function sendMessage(
  channel: string,
  text: string,
  options?: SendMessageOptions
): Promise<{ ts?: string }> {
  return postMessage({ channel, text, options });
}

/** Reply in a thread via chat.postMessage + thread_ts. */
export async function sendThreadReply(
  channel: string,
  threadTs: string,
  text: string,
  options?: SendMessageOptions
): Promise<{ ts?: string }> {
  const thread = assertNonEmpty('threadTs', threadTs);
  return postMessage({ channel, text, threadTs: thread, options });
}

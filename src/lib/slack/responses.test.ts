import { describe, expect, it, vi, beforeEach } from 'vitest';
import { dispatchSlackEvent } from '@/lib/slack/dispatcher';
import { handleAppMention } from '@/lib/slack/events/app-mention';
import { handleDirectMessage } from '@/lib/slack/events/direct-message';
import { shouldIgnoreSlackMessage } from '@/lib/slack/events/handler-utils';
import {
  sendMessage,
  sendThreadReply,
  SlackResponseError,
  type SlackPostMessageClient,
} from '@/lib/slack/responses';
import type { SlackEventEnvelope } from '@/lib/slack/types';

const mockGenerate = async () => ({
  text: 'Hello! How can I help you today?',
  model: 'gpt-4o-mini',
});

function mockClient(overrides?: {
  ok?: boolean;
  error?: string;
  throwError?: Error;
}): {
  client: SlackPostMessageClient;
  postMessage: ReturnType<typeof vi.fn>;
} {
  const postMessage = vi.fn(async () => {
    if (overrides?.throwError) {
      throw overrides.throwError;
    }
    if (overrides?.ok === false) {
      return { ok: false, error: overrides.error || 'channel_not_found' };
    }
    return { ok: true, ts: '111.222' };
  });
  return {
    client: { chat: { postMessage } } as unknown as SlackPostMessageClient,
    postMessage,
  };
}

function dmEnvelope(
  over: Partial<SlackEventEnvelope['event']> = {}
): SlackEventEnvelope {
  return {
    type: 'event_callback',
    team_id: 'T1',
    event_id: 'Ev-DM',
    event: {
      type: 'message',
      channel_type: 'im',
      user: 'U1',
      channel: 'D1',
      text: 'hello',
      ts: '10.0',
      ...over,
    },
  };
}

function mentionEnvelope(
  over: Partial<SlackEventEnvelope['event']> = {}
): SlackEventEnvelope {
  return {
    type: 'event_callback',
    team_id: 'T1',
    event_id: 'Ev-AM',
    event: {
      type: 'app_mention',
      user: 'U9',
      channel: 'C1',
      text: '<@BOT> hello',
      ts: '20.0',
      ...over,
    },
  };
}

describe('shouldIgnoreSlackMessage', () => {
  it('ignores bot_id, bot_message subtype, other subtypes, missing user', () => {
    expect(shouldIgnoreSlackMessage({ type: 'message', bot_id: 'B1' })).toBe(
      true
    );
    expect(
      shouldIgnoreSlackMessage({
        type: 'message',
        subtype: 'bot_message',
        user: 'U1',
      })
    ).toBe(true);
    expect(
      shouldIgnoreSlackMessage({
        type: 'message',
        subtype: 'message_changed',
        user: 'U1',
      })
    ).toBe(true);
    expect(shouldIgnoreSlackMessage({ type: 'message', channel: 'D1' })).toBe(
      true
    );
    expect(
      shouldIgnoreSlackMessage({
        type: 'message',
        user: 'U1',
        channel: 'D1',
      })
    ).toBe(false);
  });
});

describe('sendMessage / sendThreadReply', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('validates channel and text', async () => {
    await expect(sendMessage('', 'hi')).rejects.toBeInstanceOf(
      SlackResponseError
    );
    await expect(sendMessage('C1', '  ')).rejects.toBeInstanceOf(
      SlackResponseError
    );
    await expect(sendThreadReply('C1', '', 'hi')).rejects.toBeInstanceOf(
      SlackResponseError
    );
  });

  it('posts a message via injected client', async () => {
    const { client, postMessage } = mockClient();
    await sendMessage('C1', 'hello', { client, requestId: 'r1' });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C1', text: 'hello', mrkdwn: true })
    );
  });

  it('normalizes GitHub Markdown bold before chat.postMessage', async () => {
    const { client, postMessage } = mockClient();
    await sendMessage('C1', '**รวมเวลา:** 10 ชั่วโมง', { client });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: '*รวมเวลา:* 10 ชั่วโมง' })
    );
  });

  it('posts a thread reply', async () => {
    const { client, postMessage } = mockClient();
    await sendThreadReply('C1', '1.2', 'reply', { client });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C1',
        text: 'reply',
        thread_ts: '1.2',
      })
    );
  });

  it('throws typed error on invalid Slack API response', async () => {
    const { client } = mockClient({ ok: false, error: 'invalid_auth' });
    await expect(sendMessage('C1', 'x', { client })).rejects.toMatchObject({
      name: 'SlackResponseError',
      code: 'invalid_auth',
    });
  });

  it('throws typed error on Slack API exception', async () => {
    const { client } = mockClient({
      throwError: new Error('network down'),
    });
    await expect(sendMessage('C1', 'x', { client })).rejects.toMatchObject({
      name: 'SlackResponseError',
      code: 'exception',
    });
  });
});

describe('DM / app_mention response handlers', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('DM receives AI conversation reply', async () => {
    const { client, postMessage } = mockClient();
    await handleDirectMessage(
      { requestId: 'req', envelope: dmEnvelope() },
      { client, generate: mockGenerate }
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'D1',
        text: 'Hello! How can I help you today?',
      })
    );
  });

  it('app_mention receives AI conversation reply', async () => {
    const { client, postMessage } = mockClient();
    await handleAppMention(
      { requestId: 'req', envelope: mentionEnvelope() },
      { client, generate: mockGenerate }
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C1',
        thread_ts: '20.0',
        text: 'Hello! How can I help you today?',
      })
    );
  });

  it('bot messages are ignored (no reply)', async () => {
    const { client, postMessage } = mockClient();
    await handleDirectMessage(
      {
        requestId: 'req',
        envelope: dmEnvelope({ bot_id: 'B99', user: undefined }),
      },
      { client }
    );
    await handleAppMention(
      {
        requestId: 'req',
        envelope: mentionEnvelope({ subtype: 'bot_message' }),
      },
      { client }
    );
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('handler swallows Slack API failures (no throw)', async () => {
    const { client } = mockClient({ ok: false, error: 'rate_limited' });
    await expect(
      handleDirectMessage(
        { requestId: 'req', envelope: dmEnvelope() },
        { client, generate: mockGenerate }
      )
    ).resolves.toBeUndefined();
  });

  it('handler swallows Slack API exceptions', async () => {
    const { client } = mockClient({ throwError: new Error('boom') });
    await expect(
      handleAppMention(
        { requestId: 'req', envelope: mentionEnvelope() },
        { client, generate: mockGenerate }
      )
    ).resolves.toBeUndefined();
  });
});

describe('dispatcher with responses', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('continues to route DM and mention with injected client', async () => {
    const { client, postMessage } = mockClient();
    const dm = await dispatchSlackEvent(dmEnvelope(), {
      requestId: 'r1',
      client,
      generate: mockGenerate,
    });
    const am = await dispatchSlackEvent(mentionEnvelope(), {
      requestId: 'r2',
      client,
      generate: mockGenerate,
    });
    expect(dm).toEqual({ handled: true, route: 'message.im' });
    expect(am).toEqual({ handled: true, route: 'app_mention' });
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it('ignores bot events without calling Slack API', async () => {
    const { client, postMessage } = mockClient();
    const result = await dispatchSlackEvent(
      dmEnvelope({ bot_id: 'B1', user: undefined }),
      { requestId: 'r3', client }
    );
    expect(result).toEqual({ handled: false, route: 'bot' });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('still ignores unknown events', async () => {
    const { client, postMessage } = mockClient();
    const result = await dispatchSlackEvent(
      {
        type: 'event_callback',
        event: { type: 'reaction_added', user: 'U1' },
      },
      { requestId: 'r4', client }
    );
    expect(result).toEqual({ handled: false, route: 'ignored' });
    expect(postMessage).not.toHaveBeenCalled();
  });
});

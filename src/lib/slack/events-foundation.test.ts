import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  signSlackRequest,
  verifySlackRequest,
  verifySlackSignature,
} from '@/lib/slack/verifier';
import { parseSlackEventsPayload } from '@/lib/slack/events';
import { dispatchSlackEvent } from '@/lib/slack/dispatcher';
import { POST } from '@/app/api/slack/events/route';
import type { SlackPostMessageClient } from '@/lib/slack/responses';

const SECRET = 'test-signing-secret';

vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    void p;
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock('@/lib/slack/responses', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/slack/responses')>();
  return {
    ...actual,
    sendMessage: vi.fn(async () => ({ ts: '1.0' })),
    sendThreadReply: vi.fn(async () => ({ ts: '1.0' })),
  };
});

function noopClient(): SlackPostMessageClient {
  return {
    chat: {
      postMessage: vi.fn(async () => ({ ok: true, ts: '1.0' })),
    },
  } as unknown as SlackPostMessageClient;
}

function signedRequest(body: object, opts?: { ts?: string; secret?: string; sig?: string }) {
  const rawBody = JSON.stringify(body);
  const ts = opts?.ts ?? String(Math.floor(Date.now() / 1000));
  const secret = opts?.secret ?? SECRET;
  const signature = opts?.sig ?? signSlackRequest(secret, ts, rawBody);
  return new NextRequest('http://localhost/api/slack/events', {
    method: 'POST',
    body: rawBody,
    headers: {
      'content-type': 'application/json',
      'x-slack-signature': signature,
      'x-slack-request-timestamp': ts,
    },
  });
}

describe('verifySlackRequest', () => {
  it('accepts a valid signature', () => {
    const rawBody = '{"type":"url_verification","challenge":"abc"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = signSlackRequest(SECRET, ts, rawBody);
    expect(
      verifySlackSignature(SECRET, signature, ts, rawBody)
    ).toBe(true);
    expect(
      verifySlackRequest({
        signingSecret: SECRET,
        signature,
        timestamp: ts,
        rawBody,
      })
    ).toEqual({ ok: true });
  });

  it('rejects invalid signature', () => {
    const rawBody = '{"ok":true}';
    const ts = String(Math.floor(Date.now() / 1000));
    const result = verifySlackRequest({
      signingSecret: SECRET,
      signature: 'v0=deadbeef',
      timestamp: ts,
      rawBody,
    });
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects replay outside window', () => {
    const rawBody = '{"ok":true}';
    const oldTs = String(Math.floor(Date.now() / 1000) - 60 * 10);
    const signature = signSlackRequest(SECRET, oldTs, rawBody);
    const result = verifySlackRequest({
      signingSecret: SECRET,
      signature,
      timestamp: oldTs,
      rawBody,
    });
    expect(result).toEqual({ ok: false, reason: 'replay' });
  });

  it('rejects missing secret', () => {
    const result = verifySlackRequest({
      signingSecret: '',
      signature: 'v0=x',
      timestamp: '1',
      rawBody: '{}',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing_secret');
    }
  });
});

describe('parseSlackEventsPayload', () => {
  it('parses url_verification', () => {
    const result = parseSlackEventsPayload(
      JSON.stringify({ type: 'url_verification', challenge: 'ch-1' })
    );
    expect(result).toEqual({
      ok: true,
      payload: { type: 'url_verification', challenge: 'ch-1', token: undefined },
    });
  });

  it('parses event_callback fields', () => {
    const result = parseSlackEventsPayload(
      JSON.stringify({
        type: 'event_callback',
        team_id: 'T1',
        api_app_id: 'A1',
        event_id: 'Ev1',
        event_time: 123,
        event: {
          type: 'app_mention',
          user: 'U1',
          channel: 'C1',
          text: 'hello',
          ts: '1.2',
        },
        authorizations: [{ team_id: 'T1', user_id: 'U1' }],
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.payload.type === 'event_callback') {
      expect(result.payload.team_id).toBe('T1');
      expect(result.payload.event_id).toBe('Ev1');
      expect(result.payload.event.type).toBe('app_mention');
    }
  });

  it('rejects malformed JSON', () => {
    const result = parseSlackEventsPayload('{');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_json');
    }
  });

  it('rejects unsupported payload type', () => {
    const result = parseSlackEventsPayload(JSON.stringify({ type: 'other' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsupported_payload');
    }
  });
});

describe('dispatchSlackEvent', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('routes app_mention', async () => {
    const result = await dispatchSlackEvent(
      {
        type: 'event_callback',
        team_id: 'T1',
        event_id: 'Ev1',
        event: {
          type: 'app_mention',
          user: 'U1',
          channel: 'C1',
          text: '<@BOT> hi',
          ts: '1.0',
        },
      },
      { requestId: 'req-1', client: noopClient() }
    );
    expect(result).toEqual({ handled: true, route: 'app_mention' });
  });

  it('routes message.im', async () => {
    const result = await dispatchSlackEvent(
      {
        type: 'event_callback',
        team_id: 'T1',
        event_id: 'Ev2',
        event: {
          type: 'message',
          channel_type: 'im',
          user: 'U1',
          channel: 'D1',
          text: 'hello',
          ts: '2.0',
        },
      },
      { requestId: 'req-2', client: noopClient() }
    );
    expect(result).toEqual({ handled: true, route: 'message.im' });
  });

  it('ignores unknown events safely', async () => {
    const result = await dispatchSlackEvent(
      {
        type: 'event_callback',
        event: { type: 'reaction_added', user: 'U1' },
      },
      { requestId: 'req-3', client: noopClient() }
    );
    expect(result).toEqual({ handled: false, route: 'ignored' });
  });
});

describe('POST /api/slack/events', () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SECRET;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns challenge for url_verification', async () => {
    const res = await POST(
      signedRequest({ type: 'url_verification', challenge: 'challenge-xyz' })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ challenge: 'challenge-xyz' });
  });

  it('returns 401 for invalid signature', async () => {
    const res = await POST(
      signedRequest(
        { type: 'url_verification', challenge: 'x' },
        { sig: 'v0=0000000000000000000000000000000000000000000000000000000000000000' }
      )
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 for replay attack', async () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 60 * 10);
    const res = await POST(
      signedRequest(
        { type: 'url_verification', challenge: 'x' },
        { ts: oldTs }
      )
    );
    expect(res.status).toBe(401);
  });

  it('ACKs event_callback with 200', async () => {
    const res = await POST(
      signedRequest({
        type: 'event_callback',
        team_id: 'T1',
        event_id: 'Ev9',
        event: {
          type: 'app_mention',
          user: 'U1',
          channel: 'C1',
          text: 'ping',
          ts: '9.0',
        },
      })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('returns 400 for malformed JSON', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const rawBody = '{not-json';
    const signature = signSlackRequest(SECRET, ts, rawBody);
    const req = new NextRequest('http://localhost/api/slack/events', {
      method: 'POST',
      body: rawBody,
      headers: {
        'x-slack-signature': signature,
        'x-slack-request-timestamp': ts,
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

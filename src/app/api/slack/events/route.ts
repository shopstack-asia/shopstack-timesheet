import { NextRequest, NextResponse } from 'next/server';
import { verifySlackSignature } from '@/lib/slack/client';
import { processSlackEvent } from '@/lib/slack/event-handler';
import { waitUntil } from '@vercel/functions';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signingSecret = process.env.SLACK_SIGNING_SECRET || '';
  const signature = request.headers.get('x-slack-signature');
  const timestamp = request.headers.get('x-slack-request-timestamp');

  if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const limited = await enforceRateLimit(request, {
    bucket: 'slack-events',
    limit: 300,
    windowSeconds: 60,
    failOpen: false,
  });
  if (!limited.ok) return limited.response;

  let body: {
    type?: string;
    challenge?: string;
    event?: Parameters<typeof processSlackEvent>[0];
    event_id?: string;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.type === 'url_verification' && body.challenge) {
    return NextResponse.json({ challenge: body.challenge });
  }

  if (body.type === 'event_callback' && body.event) {
    const event = body.event;
    const eventId = body.event_id;
    waitUntil(
      processSlackEvent(event, eventId).catch((err) => {
        console.error('[api/slack/events]', err);
      })
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}

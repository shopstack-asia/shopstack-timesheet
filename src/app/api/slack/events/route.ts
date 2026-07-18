import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { waitUntil } from '@vercel/functions';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  SLACK_HEADER_SIGNATURE,
  SLACK_HEADER_TIMESTAMP,
} from '@/lib/slack/constants';
import { dispatchSlackEvent } from '@/lib/slack/dispatcher';
import {
  isEventCallback,
  isUrlVerification,
  parseSlackEventsPayload,
} from '@/lib/slack/events';
import { createSlackRequestLogger } from '@/lib/slack/logger';
import { verifySlackRequest } from '@/lib/slack/verifier';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Slack Events API gateway — thin HTTP adapter.
 * Security verify → parse → dispatch (async) → ACK.
 * No AI / business logic here.
 */
export async function POST(request: NextRequest) {
  const started = Date.now();
  const requestId = randomUUID();
  const log = createSlackRequestLogger({ requestId });

  try {
    const rawBody = await request.text();
    const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim() || '';
    const signature = request.headers.get(SLACK_HEADER_SIGNATURE);
    const timestamp = request.headers.get(SLACK_HEADER_TIMESTAMP);

    const verification = verifySlackRequest({
      signingSecret,
      signature,
      timestamp,
      rawBody,
    });

    if (!verification.ok) {
      log.warn('signature verification failed', {
        verificationResult: verification.reason,
        durationMs: Date.now() - started,
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    log.info('signature verified', {
      verificationResult: 'ok',
    });

    const limited = await enforceRateLimit(request, {
      bucket: 'slack-events',
      limit: 300,
      windowSeconds: 60,
      failOpen: false,
    });
    if (!limited.ok) return limited.response;

    const parsed = parseSlackEventsPayload(rawBody);
    if (!parsed.ok) {
      log.warn('payload rejected', {
        reason: parsed.reason,
        durationMs: Date.now() - started,
      });
      return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
    }

    if (isUrlVerification(parsed.payload)) {
      log.info('url_verification', {
        durationMs: Date.now() - started,
      });
      return NextResponse.json({ challenge: parsed.payload.challenge });
    }

    if (isEventCallback(parsed.payload)) {
      const envelope = parsed.payload;
      const allowedWorkspace =
        process.env.SLACK_ALLOWED_WORKSPACE?.trim() || undefined;

      waitUntil(
        dispatchSlackEvent(envelope, {
          requestId,
          allowedWorkspace,
        }).catch((err: unknown) => {
          log.error('dispatch failed', {
            eventId: envelope.event_id,
            eventType: envelope.event?.type,
            error: err instanceof Error ? err.message : 'unknown',
          });
        })
      );

      log.info('event_callback acknowledged', {
        eventId: envelope.event_id,
        eventType: envelope.event?.type,
        team: envelope.team_id,
        durationMs: Date.now() - started,
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  } catch (error) {
    log.error('internal error', {
      error: error instanceof Error ? error.message : 'unknown',
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

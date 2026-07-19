import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifySlackSignature } from '@/lib/slack/client';
import { getSlackConfig } from '@/lib/slack/config';
import { processSlackInteraction } from '@/lib/slack/event-handler';
import {
  handleAppHomeAction,
  isAppHomeAction,
  type AppHomeActionPayload,
} from '@/lib/slack/app-home/actions';
import {
  evaluateWorkspaceAccess,
  resolveConfiguredAllowedWorkspace,
} from '@/lib/slack/app-home/workspace';
import { waitUntil } from '@vercel/functions';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function resolveAllowedWorkspace(): string | undefined {
  try {
    return resolveConfiguredAllowedWorkspace(getSlackConfig());
  } catch {
    return resolveConfiguredAllowedWorkspace(null);
  }
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const started = Date.now();
  const rawBody = await request.text();
  const signingSecret = process.env.SLACK_SIGNING_SECRET || '';
  const signature = request.headers.get('x-slack-signature');
  const timestamp = request.headers.get('x-slack-request-timestamp');

  if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const limited = await enforceRateLimit(request, {
    bucket: 'slack-interactions',
    limit: 120,
    windowSeconds: 60,
    failOpen: false,
  });
  if (!limited.ok) return limited.response;

  const params = new URLSearchParams(rawBody);
  const payloadRaw = params.get('payload');
  if (!payloadRaw) {
    return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
  }

  let payload: AppHomeActionPayload &
    Parameters<typeof processSlackInteraction>[0];
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  if (isAppHomeAction(payload)) {
    const allowedWorkspaceId = resolveAllowedWorkspace();
    const actualWorkspaceId = payload.team?.id;
    const check = evaluateWorkspaceAccess({
      actualWorkspaceId,
      allowedWorkspaceId,
    });

    if (check.outcome !== 'allowed') {
      console.log(
        JSON.stringify({
          scope: 'slack-app-home',
          level: 'info',
          message: 'workspace rejected',
          requestId,
          handler: 'interactions_route',
          action: payload.actions?.[0]?.action_id,
          actualWorkspaceId: actualWorkspaceId?.trim() || undefined,
          allowedWorkspaceConfigured: Boolean(allowedWorkspaceId),
          workspaceOutcome: check.outcome,
          publishOutcome: 'skipped',
          durationMs: Date.now() - started,
          ts: new Date().toISOString(),
        })
      );
      // ACK 200 so Slack does not retry — do not call handler
      return new NextResponse('', { status: 200 });
    }

    waitUntil(
      handleAppHomeAction(payload, {
        requestId,
        allowedWorkspaceId,
      }).catch((err) => {
        console.error(
          JSON.stringify({
            scope: 'slack-app-home',
            level: 'error',
            message: 'interaction handler error',
            requestId,
            errorClass: err instanceof Error ? err.name : 'unknown',
            ts: new Date().toISOString(),
          })
        );
      })
    );
    return new NextResponse('', { status: 200 });
  }

  waitUntil(
    processSlackInteraction(payload).catch((err) => {
      console.error('[api/slack/interactions]', err);
    })
  );

  return new NextResponse('', { status: 200 });
}

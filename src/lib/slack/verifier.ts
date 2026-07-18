import crypto from 'crypto';
import {
  SLACK_REPLAY_WINDOW_SECONDS,
  SLACK_SIGNATURE_VERSION,
} from '@/lib/slack/constants';
import type { SlackVerificationResult } from '@/lib/slack/types';

/**
 * Verify Slack request signature + replay window.
 * Reuses the same algorithm historically in `client.ts` (single implementation).
 */
export function verifySlackSignature(
  signingSecret: string,
  signature: string | null,
  timestamp: string | null,
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  return verifySlackRequest({
    signingSecret,
    signature,
    timestamp,
    rawBody,
    nowSeconds,
  }).ok;
}

export function verifySlackRequest(params: {
  signingSecret: string;
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
  nowSeconds?: number;
}): SlackVerificationResult {
  const {
    signingSecret,
    signature,
    timestamp,
    rawBody,
    nowSeconds = Math.floor(Date.now() / 1000),
  } = params;

  if (!signingSecret) {
    return { ok: false, reason: 'missing_secret' };
  }
  if (!signature || !timestamp) {
    return { ok: false, reason: 'missing_headers' };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'replay' };
  }

  if (Math.abs(nowSeconds - ts) > SLACK_REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: 'replay' };
  }

  const base = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac('sha256', signingSecret)
    .update(base)
    .digest('hex');
  const computed = `${SLACK_SIGNATURE_VERSION}=${hmac}`;

  try {
    const a = Buffer.from(computed);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'bad_signature' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}

/** Test helper: build a valid `x-slack-signature` for a body + timestamp. */
export function signSlackRequest(
  signingSecret: string,
  timestamp: string,
  rawBody: string
): string {
  const base = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac('sha256', signingSecret)
    .update(base)
    .digest('hex');
  return `${SLACK_SIGNATURE_VERSION}=${hmac}`;
}

import { WebClient } from '@slack/web-api';
import crypto from 'crypto';

let client: WebClient | null = null;

export function getSlackClient(): WebClient {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN is not configured');
  }
  if (!client) {
    client = new WebClient(token);
  }
  return client;
}

export function verifySlackSignature(
  signingSecret: string,
  signature: string | null,
  timestamp: string | null,
  rawBody: string
): boolean {
  if (!signature || !timestamp || !signingSecret) {
    return false;
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  // Reject stale requests (> 5 minutes)
  if (Math.abs(Date.now() / 1000 - ts) > 60 * 5) {
    return false;
  }
  const base = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
  const computed = `v0=${hmac}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function postSlackMessage(params: {
  channel: string;
  text: string;
  threadTs?: string;
}): Promise<void> {
  const slack = getSlackClient();
  await slack.chat.postMessage({
    channel: params.channel,
    text: params.text,
    thread_ts: params.threadTs,
    mrkdwn: true,
  });
}

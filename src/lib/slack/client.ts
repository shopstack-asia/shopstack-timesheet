import { WebClient } from '@slack/web-api';

// Re-export verifier so existing imports from `@/lib/slack/client` keep working.
export { verifySlackSignature } from '@/lib/slack/verifier';

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

/** @deprecated Prefer sendMessage / sendThreadReply from `@/lib/slack/responses`. */
export async function postSlackMessage(params: {
  channel: string;
  text: string;
  threadTs?: string;
}): Promise<void> {
  // Dynamic import avoids circular init with responses.ts
  const { sendMessage, sendThreadReply } = await import('@/lib/slack/responses');
  if (params.threadTs) {
    await sendThreadReply(params.channel, params.threadTs, params.text);
    return;
  }
  await sendMessage(params.channel, params.text);
}

/** Reset cached WebClient (tests only). */
export function resetSlackClientCache(): void {
  client = null;
}

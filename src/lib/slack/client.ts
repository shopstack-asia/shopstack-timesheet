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

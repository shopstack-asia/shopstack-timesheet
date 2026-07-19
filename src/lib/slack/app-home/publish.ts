/**
 * Slack views.publish wrapper for App Home.
 */

import type { WebClient } from '@slack/web-api';
import { getSlackClient } from '@/lib/slack/client';
import type { SlackHomeView } from '@/lib/slack/app-home/view-builder';

export type SlackViewsPublishClient = {
  views: {
    publish: (args: {
      user_id: string;
      view: SlackHomeView;
    }) => Promise<{ ok?: boolean; error?: string }>;
  };
};

export type SlackViewsOpenClient = {
  views: {
    open: (args: {
      trigger_id: string;
      view: Record<string, unknown>;
    }) => Promise<{ ok?: boolean; error?: string }>;
  };
};

export async function publishAppHomeView(input: {
  slackUserId: string;
  view: SlackHomeView;
  client?: SlackViewsPublishClient;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = input.client ?? (getSlackClient() as unknown as SlackViewsPublishClient);
  try {
    const result = await client.views.publish({
      user_id: input.slackUserId,
      view: input.view,
    });
    if (result.ok === false) {
      return { ok: false, error: result.error || 'views_publish_failed' };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'views_publish_failed',
    };
  }
}

export async function openAppHomeModal(input: {
  triggerId: string;
  view: Record<string, unknown>;
  client?: SlackViewsOpenClient;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = input.client ?? (getSlackClient() as unknown as SlackViewsOpenClient);
  try {
    const result = await client.views.open({
      trigger_id: input.triggerId,
      view: input.view,
    });
    if (result.ok === false) {
      return { ok: false, error: result.error || 'views_open_failed' };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'views_open_failed',
    };
  }
}

/** Type guard helper for full WebClient */
export function asViewsClient(client: WebClient): SlackViewsPublishClient & SlackViewsOpenClient {
  return client as unknown as SlackViewsPublishClient & SlackViewsOpenClient;
}

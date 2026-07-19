/**
 * app_home_opened event handler — read-only Home dashboard.
 * No OpenAI, no Timesheet writes, no DM posts.
 */

import { getSlackConfig } from '@/lib/slack/config';
import {
  APP_HOME_LOADING_DELAY_MS,
  EVENT_APP_HOME_OPENED,
} from '@/lib/slack/app-home/constants';
import {
  loadAppHomeDashboard,
  type AppHomeLoaderDeps,
} from '@/lib/slack/app-home/data-loader';
import { createAppHomeLogger } from '@/lib/slack/app-home/logger';
import {
  publishAppHomeView,
  type SlackViewsPublishClient,
} from '@/lib/slack/app-home/publish';
import {
  buildAppHomeView,
  type SlackHomeView,
} from '@/lib/slack/app-home/view-builder';
import type { EventHandlerContext } from '@/lib/slack/events/handler-utils';
import { wasEventProcessed } from '@/lib/timesheet-agent/conversation-state';

export type AppHomeHandlerDeps = AppHomeLoaderDeps & {
  client?: SlackViewsPublishClient;
  /** Injectable event dedupe (defaults to Redis wasEventProcessed) */
  wasProcessed?: (dedupeId: string) => Promise<boolean>;
  /** When true, may publish a loading view if data is slow */
  enableLoadingView?: boolean;
  loadingDelayMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Handle Slack `app_home_opened` for tab=home only.
 */
export async function handleAppHomeOpened(
  ctx: EventHandlerContext,
  deps: AppHomeHandlerDeps = {}
): Promise<{ published: boolean; reason?: string }> {
  const started = Date.now();
  const event = ctx.envelope.event;
  const slackUserId = event.user?.trim();
  const eventId = ctx.envelope.event_id?.trim();
  const log = createAppHomeLogger({
    requestId: ctx.requestId,
    eventId,
    handler: 'app_home_opened',
    slackUserId,
  });

  try {
    let enableAppHome = true;
    try {
      enableAppHome = getSlackConfig().enableAppHome;
    } catch {
      enableAppHome = true;
    }
    if (!enableAppHome) {
      log.info('app home disabled', { publishOutcome: 'skipped' });
      return { published: false, reason: 'disabled' };
    }

    if (event.type !== EVENT_APP_HOME_OPENED) {
      return { published: false, reason: 'wrong_event' };
    }

    const tab = (event as { tab?: string }).tab;
    if (tab && tab !== 'home') {
      log.info('non-home tab ignored', {
        tab,
        publishOutcome: 'skipped',
        durationMs: Date.now() - started,
      });
      return { published: false, reason: 'non_home_tab' };
    }

    if (!slackUserId) {
      log.warn('missing user on app_home_opened');
      return { published: false, reason: 'missing_user' };
    }

    const dedupeId = eventId || `app_home:${slackUserId}:${event.event_ts || ''}`;
    const wasProcessed = deps.wasProcessed ?? wasEventProcessed;
    if (await wasProcessed(dedupeId)) {
      log.info('duplicate event ignored', {
        publishOutcome: 'deduped',
        durationMs: Date.now() - started,
      });
      return { published: false, reason: 'deduped' };
    }

    const loadPromise = loadAppHomeDashboard(slackUserId, {
      requestId: ctx.requestId,
      ...deps,
    });

    let loadingPublished = false;
    const enableLoading = deps.enableLoadingView !== false;
    const delayMs = deps.loadingDelayMs ?? APP_HOME_LOADING_DELAY_MS;

    if (enableLoading) {
      const raced = await Promise.race([
        loadPromise.then((r) => ({ kind: 'loaded' as const, result: r })),
        sleep(delayMs).then(() => ({ kind: 'slow' as const })),
      ]);

      if (raced.kind === 'slow') {
        const loadingView = buildAppHomeView({ kind: 'loading' });
        const pub = await publishAppHomeView({
          slackUserId,
          view: loadingView,
          client: deps.client,
        });
        loadingPublished = pub.ok;
        log.info('loading view published', {
          publishOutcome: pub.ok ? 'loading_ok' : 'loading_failed',
        });
      }
    }

    const loaded = await loadPromise;
    const view: SlackHomeView = buildAppHomeView(loaded.model);
    const published = await publishAppHomeView({
      slackUserId,
      view,
      client: deps.client,
    });

    log.info('app home publish complete', {
      identityOutcome: loaded.identityOutcome,
      timesheetOutcome: loaded.timesheetOutcome,
      workContextOutcome: loaded.workContextOutcome,
      publishOutcome: published.ok
        ? loadingPublished
          ? 'final_after_loading'
          : 'ok'
        : 'failed',
      durationMs: Date.now() - started,
    });

    return {
      published: published.ok,
      reason: published.ok ? undefined : published.error,
    };
  } catch (error) {
    log.error('app home handler failed', {
      publishOutcome: 'error',
      durationMs: Date.now() - started,
      errorClass: error instanceof Error ? error.name : 'unknown',
    });
    // Best-effort identity/dependency error view — never throw to route
    if (event.user) {
      try {
        const view = buildAppHomeView({ kind: 'dependency_error' });
        await publishAppHomeView({
          slackUserId: event.user,
          view,
          client: deps.client,
        });
      } catch {
        // swallow
      }
    }
    return { published: false, reason: 'handler_error' };
  }
}

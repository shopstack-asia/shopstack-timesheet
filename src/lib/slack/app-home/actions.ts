/**
 * App Home Block Kit action handlers — refresh / help / retry.
 * Read-only; no identity in values; no OpenAI; no Timesheet writes.
 */

import {
  APP_HOME_ACTION,
  APP_HOME_VALUE,
} from '@/lib/slack/app-home/constants';
import {
  loadAppHomeDashboard,
  type AppHomeLoaderDeps,
} from '@/lib/slack/app-home/data-loader';
import { createAppHomeLogger } from '@/lib/slack/app-home/logger';
import {
  openAppHomeModal,
  publishAppHomeView,
} from '@/lib/slack/app-home/publish';
import {
  buildAppHomeHelpModal,
  buildAppHomeView,
} from '@/lib/slack/app-home/view-builder';
import { wasEventProcessed } from '@/lib/timesheet-agent/conversation-state';

export type AppHomeActionPayload = {
  type?: string;
  trigger_id?: string;
  user?: { id?: string };
  actions?: Array<{
    action_id?: string;
    value?: string;
    action_ts?: string;
  }>;
  /** Forged identity fields must be ignored */
  employeeId?: string;
  staffId?: string;
  email?: string;
  private_metadata?: string;
};

export type AppHomeViewsClient = {
  views: {
    publish: (args: {
      user_id: string;
      view: import('@/lib/slack/app-home/view-builder').SlackHomeView;
    }) => Promise<{ ok?: boolean; error?: string }>;
    open?: (args: {
      trigger_id: string;
      view: Record<string, unknown>;
    }) => Promise<{ ok?: boolean; error?: string }>;
  };
};

export type AppHomeActionDeps = AppHomeLoaderDeps & {
  client?: AppHomeViewsClient;
  wasProcessed?: (dedupeId: string) => Promise<boolean>;
  requestId?: string;
};

export function isAppHomeAction(payload: AppHomeActionPayload): boolean {
  const actionId = payload.actions?.[0]?.action_id || '';
  return (
    actionId === APP_HOME_ACTION.refresh ||
    actionId === APP_HOME_ACTION.help ||
    actionId === APP_HOME_ACTION.retry ||
    actionId === APP_HOME_ACTION.openTimesheet
  );
}

/**
 * Handle App Home button actions.
 * Ignores any employee identity fields on the payload.
 */
export async function handleAppHomeAction(
  payload: AppHomeActionPayload,
  deps: AppHomeActionDeps = {}
): Promise<{ handled: boolean; reason?: string }> {
  const started = Date.now();
  const action = payload.actions?.[0];
  const actionId = action?.action_id || '';
  const slackUserId = payload.user?.id?.trim();

  const log = createAppHomeLogger({
    requestId: deps.requestId,
    handler: 'app_home_action',
    action: actionId,
    slackUserId,
  });

  // Explicitly ignore forged identity on the payload
  void payload.employeeId;
  void payload.staffId;
  void payload.email;
  void payload.private_metadata;

  if (!slackUserId) {
    log.warn('missing action user');
    return { handled: false, reason: 'missing_user' };
  }

  if (actionId === APP_HOME_ACTION.openTimesheet) {
    // URL button — Slack opens the link client-side; nothing to do server-side
    log.info('open timesheet url action ack', {
      publishOutcome: 'noop',
      durationMs: Date.now() - started,
    });
    return { handled: true, reason: 'url_button' };
  }

  const dedupeId =
    action?.action_ts ||
    `${actionId}:${slackUserId}:${payload.trigger_id || ''}`;
  const wasProcessed = deps.wasProcessed ?? wasEventProcessed;
  if (await wasProcessed(`app_home_action:${dedupeId}`)) {
    log.info('duplicate action ignored', {
      publishOutcome: 'deduped',
      durationMs: Date.now() - started,
    });
    return { handled: true, reason: 'deduped' };
  }

  // Validate button values are non-sensitive constants when present
  const value = action?.value;
  if (
    value &&
    value !== APP_HOME_VALUE.refresh &&
    value !== APP_HOME_VALUE.help &&
    value !== APP_HOME_VALUE.retry
  ) {
    log.warn('rejected unsafe action value', { publishOutcome: 'rejected' });
    return { handled: false, reason: 'unsafe_value' };
  }

  try {
    if (actionId === APP_HOME_ACTION.help) {
      if (payload.trigger_id && deps.client?.views?.open) {
        const modal = buildAppHomeHelpModal();
        const opened = await openAppHomeModal({
          triggerId: payload.trigger_id,
          view: modal as unknown as Record<string, unknown>,
          client: { views: { open: deps.client.views.open } },
        });
        log.info('help modal', {
          publishOutcome: opened.ok ? 'ok' : 'failed',
          durationMs: Date.now() - started,
        });
        return { handled: true, reason: opened.ok ? undefined : opened.error };
      }
      // Fallback: republish Home with expanded help
      const loaded = await loadAppHomeDashboard(slackUserId, {
        requestId: deps.requestId,
        showHelpExpanded: true,
        ...deps,
      });
      const view = buildAppHomeView(loaded.model);
      const published = await publishAppHomeView({
        slackUserId,
        view,
        client: deps.client,
      });
      log.info('help expanded home', {
        identityOutcome: loaded.identityOutcome,
        publishOutcome: published.ok ? 'ok' : 'failed',
        durationMs: Date.now() - started,
      });
      return { handled: true };
    }

    // refresh / retry — reload dashboard
    const loaded = await loadAppHomeDashboard(slackUserId, {
      requestId: deps.requestId,
      ...deps,
    });
    const view = buildAppHomeView(loaded.model);
    const published = await publishAppHomeView({
      slackUserId,
      view,
      client: deps.client,
    });

    log.info('app home action publish', {
      identityOutcome: loaded.identityOutcome,
      timesheetOutcome: loaded.timesheetOutcome,
      workContextOutcome: loaded.workContextOutcome,
      publishOutcome: published.ok ? 'ok' : 'failed',
      durationMs: Date.now() - started,
    });

    return {
      handled: true,
      reason: published.ok ? undefined : published.error,
    };
  } catch (error) {
    log.error('app home action failed', {
      publishOutcome: 'error',
      durationMs: Date.now() - started,
      errorClass: error instanceof Error ? error.name : 'unknown',
    });
    try {
      await publishAppHomeView({
        slackUserId,
        view: buildAppHomeView({ kind: 'dependency_error' }),
        client: deps.client,
      });
    } catch {
      // swallow
    }
    return { handled: true, reason: 'handler_error' };
  }
}

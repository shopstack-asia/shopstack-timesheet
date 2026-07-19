/**
 * App Home data loader — Conversation Context + canonical reads only.
 * No OpenAI, no writes, no identity from UI payloads.
 */

import {
  getDefaultContextManager,
  type ContextManager,
} from '@/lib/conversation/context/context-manager';
import { buildAppHomeConversationId } from '@/lib/slack/app-home/constants';
import { selectAppHomeProjects } from '@/lib/slack/app-home/projects';
import type {
  AppHomeDayRow,
  AppHomeLoadResult,
  AppHomeViewModel,
} from '@/lib/slack/app-home/types';
import { getSafeAppHomeTimesheetUrl } from '@/lib/slack/app-home/url';
import {
  bangkokMondaySundayWeek,
  thaiDayMonthShort,
  thaiWeekdayShort,
  thaiWeekRangeLabel,
} from '@/lib/slack/app-home/week';
import {
  readTimesheetRangeForEmployee,
  type CanonicalReadOptions,
} from '@/lib/timesheet/canonical-read';
import type { TimeLogRowsLoader } from '@/lib/timesheet/timesheet-service';
import type { TimesheetRange, WorkContext } from '@/lib/tools/business/types';

export type AppHomeLoaderDeps = {
  contextManager?: ContextManager;
  readTimesheetRange?: typeof readTimesheetRangeForEmployee;
  loadWorkContext?: (
    employeeId: string,
    options: { requestId?: string; conversationId: string; slackUserId: string }
  ) => Promise<WorkContext | undefined>;
  timesheetLoader?: TimeLogRowsLoader;
  now?: Date;
  getTimesheetUrl?: () => string | undefined;
};

export type LoadAppHomeDashboardInput = {
  /** Trusted Slack user from verified event/action */
  slackUserId: string;
  /**
   * Trusted workspace id from envelope.team_id / payload.team.id.
   * Empty string → explicit `unscoped` Conversation Context namespace.
   */
  workspaceId: string;
  requestId?: string;
  showHelpExpanded?: boolean;
} & AppHomeLoaderDeps;

function displayFirstName(employeeName?: string): string | undefined {
  const n = employeeName?.trim();
  if (!n) return undefined;
  return n.split(/\s+/)[0] || n;
}

function mapDays(
  range: TimesheetRange | undefined,
  weekDates: string[],
  today: string
): AppHomeDayRow[] {
  const byDate = new Map(
    (range?.days || []).map((d) => [d.date, d.totalHours] as const)
  );
  return weekDates.map((date) => ({
    date,
    weekdayLabel: thaiWeekdayShort(date),
    dateLabel: thaiDayMonthShort(date),
    hours: byDate.has(date) ? byDate.get(date)! : 0,
    isToday: date === today,
  }));
}

async function defaultLoadWorkContext(
  manager: ContextManager,
  input: {
    employeeId: string;
    requestId?: string;
    conversationId: string;
    slackUserId: string;
  }
): Promise<WorkContext | undefined> {
  void input.employeeId;
  const ctx = await manager.getConversationContext({
    conversationId: input.conversationId,
    slackUserId: input.slackUserId,
    requestId: input.requestId,
    ensureWorkContext: true,
    forceRefreshWorkContext: true,
  });
  return ctx.workContext;
}

/**
 * Load App Home dashboard data.
 * Builds a workspace-scoped Conversation Context id internally.
 */
export async function loadAppHomeDashboard(
  input: LoadAppHomeDashboardInput
): Promise<AppHomeLoadResult> {
  const slackUserId = input.slackUserId.trim();
  const workspaceId = input.workspaceId;
  const manager = input.contextManager ?? getDefaultContextManager();
  const readRange = input.readTimesheetRange ?? readTimesheetRangeForEmployee;
  const timesheetUrl = (input.getTimesheetUrl ?? getSafeAppHomeTimesheetUrl)();
  const now = input.now ?? new Date();
  const week = bangkokMondaySundayWeek(now);
  const conversationId = buildAppHomeConversationId(workspaceId, slackUserId);

  let displayName: string | undefined;
  let identityEmail: string | undefined;
  let employeeId: string | undefined;

  try {
    const ctx = await manager.getConversationContext({
      conversationId,
      slackUserId,
      requestId: input.requestId,
      ensureWorkContext: false,
    });
    displayName = displayFirstName(ctx.employeeName);
    identityEmail = ctx.slackEmail;
    employeeId = ctx.employeeId;
  } catch {
    return {
      model: { kind: 'identity_error', timesheetUrl },
      identityOutcome: 'failed',
      timesheetOutcome: 'skipped',
      workContextOutcome: 'skipped',
    };
  }

  if (!employeeId || !identityEmail) {
    return {
      model: { kind: 'identity_error', timesheetUrl },
      identityOutcome: 'failed',
      timesheetOutcome: 'skipped',
      workContextOutcome: 'skipped',
    };
  }

  const loadWork =
    input.loadWorkContext ??
    ((empId: string, opts: {
      requestId?: string;
      conversationId: string;
      slackUserId: string;
    }) => defaultLoadWorkContext(manager, { employeeId: empId, ...opts }));

  const readOpts: CanonicalReadOptions = {
    requestId: input.requestId,
    conversationId,
    loader: input.timesheetLoader,
  };

  const [tsSettled, wcSettled] = await Promise.allSettled([
    readRange(
      {
        employeeId,
        email: identityEmail,
        slackUserId,
      },
      week.startDate,
      week.endDate,
      readOpts
    ),
    loadWork(employeeId, {
      requestId: input.requestId,
      conversationId,
      slackUserId,
    }),
  ]);

  let timesheetOutcome: AppHomeLoadResult['timesheetOutcome'] = 'failed';
  let workContextOutcome: AppHomeLoadResult['workContextOutcome'] = 'failed';
  let range: TimesheetRange | undefined;
  let workContext: WorkContext | undefined;

  if (tsSettled.status === 'fulfilled') {
    range = tsSettled.value;
    timesheetOutcome =
      range.totalHours === 0 &&
      range.days.every((d) => d.entries.length === 0)
        ? 'empty'
        : 'ok';
  }

  if (wcSettled.status === 'fulfilled') {
    workContext = wcSettled.value;
    const selected = selectAppHomeProjects(workContext);
    workContextOutcome =
      selected.projects.length === 0 ? 'empty' : 'ok';
  }

  if (timesheetOutcome === 'failed' && workContextOutcome === 'failed') {
    return {
      model: { kind: 'dependency_error', timesheetUrl },
      identityOutcome: 'ok',
      timesheetOutcome,
      workContextOutcome,
    };
  }

  const projectSelection = selectAppHomeProjects(workContext);
  const days = mapDays(range, week.dates, week.today);
  const totalHours =
    range?.totalHours ??
    days.reduce((sum, d) => sum + d.hours, 0);

  const model: AppHomeViewModel = {
    kind: 'dashboard',
    displayName,
    timesheetUrl,
    showHelpExpanded: input.showHelpExpanded,
    timesheet: {
      status:
        timesheetOutcome === 'failed'
          ? 'error'
          : timesheetOutcome === 'empty'
            ? 'empty'
            : 'ok',
      weekLabel: thaiWeekRangeLabel(week.startDate, week.endDate),
      totalHours,
      days: timesheetOutcome === 'failed' ? [] : days,
    },
    projects: {
      status:
        workContextOutcome === 'failed'
          ? 'error'
          : workContextOutcome === 'empty'
            ? 'empty'
            : 'ok',
      projects: projectSelection.projects,
      extraCount: projectSelection.extraCount,
    },
  };

  return {
    model,
    identityOutcome: 'ok',
    timesheetOutcome,
    workContextOutcome,
  };
}

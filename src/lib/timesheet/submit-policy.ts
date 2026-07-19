import { AgentAuthContext } from '@/lib/timesheet/agent-auth';
import { entriesToDaySet } from '@/lib/timesheet-agent/merge';
import {
  evaluateWriteGuards,
  PolicyCode,
} from '@/lib/timesheet-agent/guardrails';
import { getAgentTimeZone, zonedYmd } from '@/lib/timesheet-agent/dates';

export type SubmitPolicyEntry = {
  projectId: string;
  taskId: string;
  hours: number;
};

export type SubmitAckFlags = {
  leaveOverride?: boolean;
  holidayAcknowledged?: boolean;
  futureAcknowledged?: boolean;
  over24Acknowledged?: boolean;
};

export class SubmitPolicyError extends Error {
  readonly statusCode = 400;
  readonly policyCode?: PolicyCode;

  constructor(message: string, policyCode?: PolicyCode) {
    super(message);
    this.name = 'SubmitPolicyError';
    this.policyCode = policyCode;
  }
}

/** Leave/holiday dependency unavailable — fail closed */
export class SubmitPolicyDependencyError extends Error {
  readonly statusCode = 503;
  readonly code:
    | 'holiday_source_unavailable'
    | 'holiday_data_invalid'
    | 'leave_source_unavailable'
    | 'redis_unavailable';
  readonly requestedYear?: number;

  constructor(
    message = 'Timesheet policy data is temporarily unavailable',
    options?: {
      code?: SubmitPolicyDependencyError['code'];
      requestedYear?: number;
    }
  ) {
    super(message);
    this.name = 'SubmitPolicyDependencyError';
    this.code = options?.code ?? 'holiday_source_unavailable';
    this.requestedYear = options?.requestedYear;
  }
}

/**
 * Server-side business rules for any timesheet day write (web, Slack, future callers).
 * Empty entries (clear day) skip leave/holiday/hour content rules.
 * Leave and holiday loads fail closed (503), never treated as empty.
 * Holiday cache miss triggers Zoho reload; only canonical failure → 503.
 */
export async function assertSubmitBusinessRules(
  ctx: AgentAuthContext,
  date: string,
  entries: SubmitPolicyEntry[],
  acks: SubmitAckFlags = {},
  deps?: {
    loadLeave?: (
      ctx: AgentAuthContext,
      year: number,
      month: number
    ) => Promise<import('@/types').LeaveDayEntry[]>;
    loadHolidays?: (
      ctx: AgentAuthContext,
      year: number
    ) => Promise<import('@/types').Holiday[]>;
    requestId?: string;
  }
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  for (const e of entries) {
    if (!(e.hours > 0)) {
      throw new SubmitPolicyError('Hours must be greater than 0', 'HOURS_INVALID');
    }
    if (e.hours > 24) {
      throw new SubmitPolicyError(
        'Hours must be at most 24 per entry',
        'HOURS_INVALID'
      );
    }
  }

  const tz = getAgentTimeZone();
  const today = zonedYmd(tz);
  const isFuture = date > today;

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));

  let leave: import('@/types').LeaveDayEntry[];
  let holidays: import('@/types').Holiday[];

  try {
    if (deps?.loadLeave) {
      leave = await deps.loadLeave(ctx, year, month);
    } else {
      const { getLeaveMonthlyForStaff } = await import('@/lib/timesheet/master-service');
      leave = await getLeaveMonthlyForStaff(ctx, year, month);
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: 'submit-policy',
        level: 'error',
        message: 'leave_source_unavailable',
        dependency: 'leave',
        requestId: deps?.requestId,
        requestedYear: year,
        error: error instanceof Error ? error.message : 'unknown',
        ts: new Date().toISOString(),
      })
    );
    throw new SubmitPolicyDependencyError(
      'Leave data is temporarily unavailable',
      { code: 'leave_source_unavailable', requestedYear: year }
    );
  }

  try {
    if (deps?.loadHolidays) {
      holidays = await deps.loadHolidays(ctx, year);
    } else {
      const { getHolidaysForStaff } = await import('@/lib/timesheet/master-service');
      holidays = await getHolidaysForStaff(ctx, year, {
        requestId: deps?.requestId,
      });
    }
  } catch (error) {
    const { HolidayUnavailableError } = await import('@/lib/holiday-cache');
    const code =
      error instanceof HolidayUnavailableError
        ? error.code
        : 'holiday_source_unavailable';
    console.error(
      JSON.stringify({
        scope: 'submit-policy',
        level: 'error',
        message: 'holiday_dependency_unavailable',
        dependency: 'holiday',
        requestId: deps?.requestId,
        requestedYear: year,
        cacheOutcome:
          error instanceof HolidayUnavailableError
            ? error.cacheOutcome
            : undefined,
        canonicalOutcome:
          error instanceof HolidayUnavailableError
            ? error.canonicalOutcome
            : 'failed',
        error: error instanceof Error ? error.message : 'unknown',
        ts: new Date().toISOString(),
      })
    );
    throw new SubmitPolicyDependencyError(
      'Holiday data is temporarily unavailable',
      {
        code:
          code === 'holiday_data_invalid'
            ? 'holiday_data_invalid'
            : code === 'redis_unavailable'
              ? 'redis_unavailable'
              : 'holiday_source_unavailable',
        requestedYear: year,
      }
    );
  }

  const daySet = entriesToDaySet(
    entries.map((e) => ({
      projectId: e.projectId,
      taskId: e.taskId,
      hours: e.hours,
    }))
  );

  const result = evaluateWriteGuards({
    date,
    daySet,
    leave,
    holidays,
    isFuture,
    createCustomProject: false,
    leaveOverride: acks.leaveOverride,
    holidayAcknowledged: acks.holidayAcknowledged,
    futureAcknowledged: acks.futureAcknowledged,
    over24Acknowledged: acks.over24Acknowledged,
  });

  if (!result.ok) {
    throw new SubmitPolicyError(
      result.blockMessage || 'Timesheet policy rejected this save.',
      result.policyCode
    );
  }
}

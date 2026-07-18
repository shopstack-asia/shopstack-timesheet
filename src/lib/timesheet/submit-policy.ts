import { AgentAuthContext } from '@/lib/timesheet/agent-auth';
import { entriesToDaySet } from '@/lib/timesheet-agent/merge';
import { evaluateWriteGuards } from '@/lib/timesheet-agent/guardrails';
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
  constructor(message: string) {
    super(message);
    this.name = 'SubmitPolicyError';
  }
}

/**
 * Server-side business rules for any timesheet day write (web, Slack, future callers).
 * Empty entries (clear day) skip leave/holiday/hour content rules.
 */
export async function assertSubmitBusinessRules(
  ctx: AgentAuthContext,
  date: string,
  entries: SubmitPolicyEntry[],
  acks: SubmitAckFlags = {}
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  for (const e of entries) {
    if (!(e.hours > 0)) {
      throw new SubmitPolicyError('Hours must be greater than 0');
    }
    if (e.hours > 24) {
      throw new SubmitPolicyError('Hours must be at most 24 per entry');
    }
  }

  const tz = getAgentTimeZone();
  const today = zonedYmd(tz);
  const isFuture = date > today;

  let leave = null as Awaited<
    ReturnType<typeof import('@/lib/timesheet/master-service').getLeaveMonthlyForStaff>
  > | null;
  let holidays = null as Awaited<
    ReturnType<typeof import('@/lib/timesheet/master-service').getHolidaysForStaff>
  > | null;

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));

  try {
    const { getLeaveMonthlyForStaff } = await import('@/lib/timesheet/master-service');
    leave = await getLeaveMonthlyForStaff(ctx, year, month);
  } catch (error) {
    console.error('[submit-policy] leave load failed', error);
    leave = null;
  }

  try {
    const { getHolidaysForStaff } = await import('@/lib/timesheet/master-service');
    holidays = await getHolidaysForStaff(ctx, year);
  } catch (error) {
    console.error('[submit-policy] holiday load failed', error);
    holidays = null;
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
    throw new SubmitPolicyError(result.blockMessage || 'Timesheet policy rejected this save.');
  }
}

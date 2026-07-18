import type { Tool, ToolContext } from '@/lib/tools/types';
import {
  asBoolean,
  asNumber,
  assertNotAborted,
  isPlainObject,
  requestMeta,
  requireString,
  resolveBusinessClient,
  toolFailureFromError,
  toolSuccess,
  type BusinessToolDeps,
} from '@/lib/tools/business/helpers';
import {
  CS_CORE_PATHS,
  type WeekDaySummary,
  type WeekTimesheet,
} from '@/lib/tools/business/types';
import { ToolError } from '@/lib/tools/errors';

function parseDay(raw: unknown): WeekDaySummary {
  if (!isPlainObject(raw)) {
    throw new ToolError(
      'Malformed response: invalid week day',
      'validation_error'
    );
  }
  return {
    date: requireString(raw, 'date', 'day.date'),
    totalHours: asNumber(raw.totalHours, 0),
    submitted:
      typeof raw.submitted === 'boolean' ? raw.submitted : undefined,
  };
}

/** Normalize CS-Core week timesheet payload. */
export function parseWeekTimesheet(data: unknown): WeekTimesheet {
  if (!isPlainObject(data)) {
    throw new ToolError(
      'Malformed response: week timesheet must be an object',
      'validation_error'
    );
  }
  const weekStart = requireString(data, 'weekStart', 'weekStart');
  const daysRaw = data.days;
  if (!Array.isArray(daysRaw)) {
    throw new ToolError(
      'Malformed response: days must be an array',
      'validation_error'
    );
  }
  const days = daysRaw.map(parseDay);
  const weeklyTotal =
    typeof data.weeklyTotal === 'number'
      ? data.weeklyTotal
      : days.reduce((sum, d) => sum + d.totalHours, 0);
  return {
    weekStart,
    weekEnd: typeof data.weekEnd === 'string' ? data.weekEnd : undefined,
    days,
    weeklyTotal,
    submitted: asBoolean(data.submitted, false),
    submissionStatus:
      typeof data.submissionStatus === 'string'
        ? data.submissionStatus
        : undefined,
  };
}

export function createGetWeekTimesheetTool(deps?: BusinessToolDeps): Tool {
  return {
    name: 'get_week_timesheet',
    description: [
      'Return the current week timesheet summary: week range, daily totals, weekly total, and submission status.',
      'Use when the user asks about this week\'s hours, daily breakdown, or whether the week is submitted.',
      'Example: User says "How many hours this week?" → call get_week_timesheet.',
      'Read-only — does not create or modify entries.',
    ].join(' '),
    version: '1.0.0',
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute(_input, context: ToolContext) {
      const started = Date.now();
      try {
        assertNotAborted(context.signal);
        const client = resolveBusinessClient(deps);
        const response = await client.get<unknown>(
          CS_CORE_PATHS.weekTimesheet,
          {
            ...requestMeta(context),
            idempotent: true,
          }
        );
        const week = parseWeekTimesheet(response.data);
        return toolSuccess('get_week_timesheet', started, week);
      } catch (error) {
        return toolFailureFromError('get_week_timesheet', started, error);
      }
    },
  };
}

export const getWeekTimesheetTool = createGetWeekTimesheetTool();

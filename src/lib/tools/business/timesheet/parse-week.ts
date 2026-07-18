import {
  asBoolean,
  asNumber,
  isPlainObject,
  requireString,
} from '@/lib/tools/business/helpers';
import type {
  WeekDaySummary,
  WeekTimesheet,
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

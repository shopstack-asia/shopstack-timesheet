import { asNumber, isPlainObject } from '@/lib/tools/business/helpers';
import { parseDailyTimesheet } from '@/lib/tools/business/timesheet/parse-timesheet';
import {
  DEFAULT_EXPECTED_DAY_HOURS,
  type DailyTimesheet,
  type TimesheetRange,
} from '@/lib/tools/business/types';
import { ToolError } from '@/lib/tools/errors';

function extractDays(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!isPlainObject(data)) {
    throw new ToolError(
      'Malformed response: timesheet range must be an object or array',
      'validation_error'
    );
  }
  if (Array.isArray(data.days)) return data.days;
  if (Array.isArray(data.timesheets)) return data.timesheets;
  throw new ToolError(
    'Malformed response: missing days array',
    'validation_error'
  );
}

/** Normalize Timesheet API range payload into TimesheetRange. */
export function parseTimesheetRange(
  data: unknown,
  startDate: string,
  endDate: string
): TimesheetRange {
  const rawDays = extractDays(data);
  const days: DailyTimesheet[] = rawDays.map((d) => parseDailyTimesheet(d));

  const envelope = isPlainObject(data) ? data : {};
  const totalHours =
    typeof envelope.totalHours === 'number'
      ? envelope.totalHours
      : days.reduce((sum, d) => sum + d.totalHours, 0);
  const expectedHours =
    typeof envelope.expectedHours === 'number'
      ? envelope.expectedHours
      : days.reduce(
          (sum, d) => sum + (d.expectedHours || DEFAULT_EXPECTED_DAY_HOURS),
          0
        ) || asNumber(undefined, 0);
  const remainingHours =
    typeof envelope.remainingHours === 'number'
      ? envelope.remainingHours
      : Math.max(0, expectedHours - totalHours);

  const submittedDays =
    typeof envelope.submittedDays === 'number'
      ? envelope.submittedDays
      : days.filter((d) => d.submitted).length;
  const unsubmittedDays =
    typeof envelope.unsubmittedDays === 'number'
      ? envelope.unsubmittedDays
      : days.length - submittedDays;

  return {
    startDate:
      typeof envelope.startDate === 'string' && envelope.startDate.trim()
        ? envelope.startDate.trim()
        : startDate,
    endDate:
      typeof envelope.endDate === 'string' && envelope.endDate.trim()
        ? envelope.endDate.trim()
        : endDate,
    days,
    totalHours,
    expectedHours,
    remainingHours,
    submittedDays,
    unsubmittedDays,
  };
}

import {
  asBoolean,
  asNumber,
  isPlainObject,
  requireString,
} from '@/lib/tools/business/helpers';
import {
  DEFAULT_EXPECTED_DAY_HOURS,
  type TimesheetEntry,
  type TodayTimesheet,
} from '@/lib/tools/business/types';
import { ToolError } from '@/lib/tools/errors';

function parseEntry(raw: unknown): TimesheetEntry {
  if (!isPlainObject(raw)) {
    throw new ToolError(
      'Malformed response: invalid timesheet entry',
      'validation_error'
    );
  }
  const hours = asNumber(raw.hours, NaN);
  if (!Number.isFinite(hours) || hours < 0) {
    throw new ToolError(
      'Malformed response: entry.hours must be a non-negative number',
      'validation_error'
    );
  }
  return {
    id: typeof raw.id === 'string' ? raw.id : undefined,
    clientId: typeof raw.clientId === 'string' ? raw.clientId : undefined,
    clientName: typeof raw.clientName === 'string' ? raw.clientName : undefined,
    projectId: typeof raw.projectId === 'string' ? raw.projectId : undefined,
    projectName:
      typeof raw.projectName === 'string' ? raw.projectName : undefined,
    roleId: typeof raw.roleId === 'string' ? raw.roleId : undefined,
    roleName: typeof raw.roleName === 'string' ? raw.roleName : undefined,
    hours,
    description:
      typeof raw.description === 'string' ? raw.description : undefined,
  };
}

/** Normalize CS-Core today timesheet payload. */
export function parseTodayTimesheet(data: unknown): TodayTimesheet {
  if (!isPlainObject(data)) {
    throw new ToolError(
      'Malformed response: today timesheet must be an object',
      'validation_error'
    );
  }
  const date = requireString(data, 'date', 'date');
  const entriesRaw = data.entries;
  if (!Array.isArray(entriesRaw)) {
    throw new ToolError(
      'Malformed response: entries must be an array',
      'validation_error'
    );
  }
  const entries = entriesRaw.map(parseEntry);
  const expectedHours = asNumber(
    data.expectedHours,
    DEFAULT_EXPECTED_DAY_HOURS
  );
  const totalHours =
    typeof data.totalHours === 'number'
      ? data.totalHours
      : entries.reduce((sum, e) => sum + e.hours, 0);
  const remainingHours =
    typeof data.remainingHours === 'number'
      ? data.remainingHours
      : Math.max(0, expectedHours - totalHours);
  return {
    date,
    entries,
    totalHours,
    remainingHours,
    expectedHours,
    submitted: asBoolean(data.submitted, false),
  };
}

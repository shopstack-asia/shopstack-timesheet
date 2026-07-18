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

export function createGetTodayTimesheetTool(deps?: BusinessToolDeps): Tool {
  return {
    name: 'get_today_timesheet',
    description: [
      "Return today's timesheet for the current user: entries, total hours, remaining hours, and submitted status.",
      'Use when the user asks what they logged today, how many hours remain today, or whether today is submitted.',
      'Example: User says "What did I log today?" → call get_today_timesheet.',
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
          CS_CORE_PATHS.todayTimesheet,
          {
            ...requestMeta(context),
            idempotent: true,
          }
        );
        const today = parseTodayTimesheet(response.data);
        return toolSuccess('get_today_timesheet', started, today);
      } catch (error) {
        return toolFailureFromError('get_today_timesheet', started, error);
      }
    },
  };
}

export const getTodayTimesheetTool = createGetTodayTimesheetTool();

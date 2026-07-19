/**
 * Canonical Timesheet Read Service.
 *
 * Weekly Timesheet UI and AI Business Tools both read persisted Time Log rows
 * from Google Sheets via `getTimeLogRowsForStaffRange` — no separate /v1/timesheets contract.
 */

import { TIMESHEET_STAFF_IDENTITY_TYPE } from '@/lib/timesheet/timesheet-staff-identity';
import { AgentAuthContext, AgentAuthError } from '@/lib/timesheet/agent-auth';
import {
  getTimeLogRowsForStaffRange,
  type TimeLogRowsLoader,
} from '@/lib/timesheet/timesheet-service';
import { addCalendarDays } from '@/lib/tools/business/timesheet/bangkok-dates';
import {
  inclusiveDayCount,
  isValidCalendarDate,
} from '@/lib/tools/business/timesheet/date-input';
import {
  DEFAULT_EXPECTED_DAY_HOURS,
  MAX_TIMESHEET_RANGE_DAYS,
  type DailyTimesheet,
  type TimesheetEntry,
  type TimesheetRange,
} from '@/lib/tools/business/types';
import type { StaffProfile, TimeLogRow } from '@/types';

export type CanonicalTimesheetReadErrorCode =
  | 'identity_mapping'
  | 'integration'
  | 'timeout'
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'upstream'
  | 'contract';

export class CanonicalTimesheetReadError extends Error {
  readonly code: CanonicalTimesheetReadErrorCode;

  constructor(message: string, code: CanonicalTimesheetReadErrorCode) {
    super(message);
    this.name = 'CanonicalTimesheetReadError';
    this.code = code;
  }
}

export type CanonicalReadOptions = {
  requestId?: string;
  conversationId?: string;
  /** Injected Sheets/Time Log loader for tests */
  loader?: TimeLogRowsLoader;
};

function logRead(event: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      scope: 'timesheet-canonical-read',
      level: 'info',
      ts: new Date().toISOString(),
      ...event,
    })
  );
}

/** Build AgentAuthContext from Conversation Context identity fields. */
export function agentAuthFromConversationIdentity(input: {
  employeeId: string;
  email: string;
  slackUserId?: string;
}): AgentAuthContext {
  const employeeId = input.employeeId?.trim() || '';
  const email = input.email?.trim() || '';
  if (!employeeId) {
    throw new CanonicalTimesheetReadError(
      'Employee identity is not mapped in Conversation Context',
      'identity_mapping'
    );
  }
  if (!email.toLowerCase().endsWith('@shopstack.asia')) {
    throw new CanonicalTimesheetReadError(
      'Employee email mapping is missing or invalid',
      'identity_mapping'
    );
  }

  const staff: StaffProfile = {
    EmployeeID: employeeId,
    FirstName: '',
    LastName: '',
    Nickname: '',
    Email: email,
    Position: '',
  };

  return {
    staff,
    source: 'slack',
    slackUserId: input.slackUserId,
  };
}

/** Match Weekly Timesheet UI label: "Name (CODE)" when both exist on the Time Log row. */
export function formatProjectDisplayName(row: TimeLogRow): string | undefined {
  const name = String(row['Project Name'] || '').trim();
  const code = String(row['Project Code'] || '').trim();
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  if (code) return code;
  return undefined;
}

export function mapTimeLogRowToEntry(row: TimeLogRow): TimesheetEntry {
  const hours = Number(row.Hours);
  return {
    id: row['Time Log ID'] || undefined,
    clientName: row['Project Client'] || undefined,
    projectId: row['Project ID'] || undefined,
    projectName: formatProjectDisplayName(row),
    roleId: row['Task ID'] || undefined,
    roleName: row.Task || undefined,
    hours: Number.isFinite(hours) ? hours : 0,
  };
}

export function mapRowsToDailyTimesheet(
  date: string,
  rows: TimeLogRow[]
): DailyTimesheet {
  const dayRows = rows.filter((r) => r.Date === date);
  const entries = dayRows.map(mapTimeLogRowToEntry);
  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
  const expectedHours = DEFAULT_EXPECTED_DAY_HOURS;
  return {
    date,
    entries,
    totalHours,
    expectedHours,
    remainingHours: Math.max(0, expectedHours - totalHours),
    // Sheets Time Log has no week-submit flag; persisted rows are readable drafts.
    submitted: false,
  };
}

function wrapUpstreamError(error: unknown): never {
  if (error instanceof CanonicalTimesheetReadError) {
    throw error;
  }
  if (error instanceof AgentAuthError) {
    throw new CanonicalTimesheetReadError(error.message, 'identity_mapping');
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|ETIMEDOUT|AbortError/i.test(message)) {
    throw new CanonicalTimesheetReadError(
      'The Timesheet data source did not respond in time',
      'timeout'
    );
  }
  if (/unauthorized|401|forbidden|403/i.test(message)) {
    throw new CanonicalTimesheetReadError(
      'Unable to authenticate with the Timesheet data source',
      'authentication'
    );
  }
  if (/Failed to fetch time log|Google Sheets|ENOTFOUND|ECONNREFUSED/i.test(message)) {
    throw new CanonicalTimesheetReadError(
      'Timesheet data source integration failure (Google Sheets Time Log)',
      'integration'
    );
  }
  throw new CanonicalTimesheetReadError(
    `Timesheet read failed: ${message}`,
    'upstream'
  );
}

/**
 * Read one calendar day for the verified employee from Google Sheets Time Log
 * (same store as Weekly Timesheet UI).
 */
export async function readDailyTimesheetForEmployee(
  identity: { employeeId: string; email: string; slackUserId?: string },
  date: string,
  options?: CanonicalReadOptions
): Promise<DailyTimesheet> {
  if (!isValidCalendarDate(date)) {
    throw new CanonicalTimesheetReadError(
      'date must be a valid YYYY-MM-DD calendar day',
      'validation'
    );
  }

  const ctx = agentAuthFromConversationIdentity(identity);

  try {
    const rows = await getTimeLogRowsForStaffRange(
      ctx,
      date,
      date,
      options?.loader
    );
    const day = mapRowsToDailyTimesheet(date, rows);

    logRead({
      message: 'daily timesheet read',
      requestId: options?.requestId,
      conversationId: options?.conversationId,
      operation: 'readDailyTimesheetForEmployee',
      upstream: 'google_sheets.Time_Log',
      employeeIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
      date,
      entryCount: day.entries.length,
      totalHours: day.totalHours,
      submitted: day.submitted,
      httpStatus: null,
    });

    return day;
  } catch (error) {
    logRead({
      level: 'error',
      message: 'daily timesheet read failed',
      requestId: options?.requestId,
      conversationId: options?.conversationId,
      operation: 'readDailyTimesheetForEmployee',
      upstream: 'google_sheets.Time_Log',
      date,
      errorCode:
        error instanceof CanonicalTimesheetReadError
          ? error.code
          : 'upstream',
      error:
        error instanceof Error ? error.message : 'unknown',
    });
    wrapUpstreamError(error);
  }
}

/**
 * Read an inclusive date range for the verified employee from Google Sheets Time Log.
 */
export async function readTimesheetRangeForEmployee(
  identity: { employeeId: string; email: string; slackUserId?: string },
  startDate: string,
  endDate: string,
  options?: CanonicalReadOptions
): Promise<TimesheetRange> {
  if (!isValidCalendarDate(startDate) || !isValidCalendarDate(endDate)) {
    throw new CanonicalTimesheetReadError(
      'startDate and endDate must be valid YYYY-MM-DD calendar days',
      'validation'
    );
  }
  if (startDate > endDate) {
    throw new CanonicalTimesheetReadError(
      'startDate must not be after endDate',
      'validation'
    );
  }
  const dayCount = inclusiveDayCount(startDate, endDate);
  if (dayCount > MAX_TIMESHEET_RANGE_DAYS) {
    throw new CanonicalTimesheetReadError(
      `Date range must be at most ${MAX_TIMESHEET_RANGE_DAYS} calendar days`,
      'validation'
    );
  }

  const ctx = agentAuthFromConversationIdentity(identity);

  try {
    const rows = await getTimeLogRowsForStaffRange(
      ctx,
      startDate,
      endDate,
      options?.loader
    );

    const days: DailyTimesheet[] = [];
    for (let i = 0; i < dayCount; i++) {
      const date = addCalendarDays(startDate, i);
      days.push(mapRowsToDailyTimesheet(date, rows));
    }

    const totalHours = days.reduce((sum, d) => sum + d.totalHours, 0);
    const expectedHours = days.reduce((sum, d) => sum + d.expectedHours, 0);
    const submittedDays = days.filter((d) => d.submitted).length;
    const unsubmittedDays = days.length - submittedDays;

    const range: TimesheetRange = {
      startDate,
      endDate,
      days,
      totalHours,
      expectedHours,
      remainingHours: Math.max(0, expectedHours - totalHours),
      submittedDays,
      unsubmittedDays,
    };

    logRead({
      message: 'timesheet range read',
      requestId: options?.requestId,
      conversationId: options?.conversationId,
      operation: 'readTimesheetRangeForEmployee',
      upstream: 'google_sheets.Time_Log',
      employeeIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
      startDate,
      endDate,
      entryCount: rows.length,
      totalHours: range.totalHours,
      submittedDays,
      unsubmittedDays,
      httpStatus: null,
    });

    return range;
  } catch (error) {
    logRead({
      level: 'error',
      message: 'timesheet range read failed',
      requestId: options?.requestId,
      conversationId: options?.conversationId,
      operation: 'readTimesheetRangeForEmployee',
      upstream: 'google_sheets.Time_Log',
      startDate,
      endDate,
      errorCode:
        error instanceof CanonicalTimesheetReadError
          ? error.code
          : 'upstream',
      error:
        error instanceof Error ? error.message : 'unknown',
    });
    wrapUpstreamError(error);
  }
}

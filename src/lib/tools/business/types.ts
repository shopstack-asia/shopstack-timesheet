/**
 * Timesheet API domain types for read-only business tools.
 */

export type WorkRole = {
  id: string;
  name: string;
};

export type WorkProject = {
  id: string;
  name: string;
  roles: WorkRole[];
};

export type WorkClient = {
  id: string;
  name: string;
  projects: WorkProject[];
};

export type WorkContext = {
  user: {
    id: string;
    name: string;
  };
  clients: WorkClient[];
};

export type TimesheetEntry = {
  id?: string;
  clientId?: string;
  clientName?: string;
  projectId?: string;
  projectName?: string;
  roleId?: string;
  roleName?: string;
  hours: number;
  description?: string;
};

/** One calendar day of timesheet data. */
export type DailyTimesheet = {
  date: string;
  entries: TimesheetEntry[];
  totalHours: number;
  expectedHours: number;
  remainingHours: number;
  submitted: boolean;
};

/** @deprecated Use DailyTimesheet */
export type TodayTimesheet = DailyTimesheet;

/** Inclusive date-range summary. */
export type TimesheetRange = {
  startDate: string;
  endDate: string;
  days: DailyTimesheet[];
  totalHours: number;
  expectedHours: number;
  remainingHours: number;
  submittedDays: number;
  unsubmittedDays: number;
};

/** @deprecated Prefer TimesheetRange for multi-day reads */
export type WeekDaySummary = {
  date: string;
  totalHours: number;
  submitted?: boolean;
};

/** @deprecated Prefer TimesheetRange */
export type WeekTimesheet = {
  weekStart: string;
  weekEnd?: string;
  days: WeekDaySummary[];
  weeklyTotal: number;
  submitted: boolean;
  submissionStatus?: string;
};

/**
 * External Business API paths still used by read-only tools.
 * Daily/range timesheet reads use the canonical Google Sheets Time Log service
 * (`src/lib/timesheet/canonical-read.ts`) — not a `/v1/timesheets` HTTP contract.
 */
export const TIMESHEET_API_PATHS = {
  workContext: '/v1/work-context',
} as const;

export const DEFAULT_EXPECTED_DAY_HOURS = 8;
export const MAX_TIMESHEET_RANGE_DAYS = 31;
export const TIMESHEET_TIMEZONE = 'Asia/Bangkok';

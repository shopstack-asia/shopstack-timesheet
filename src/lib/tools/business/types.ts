/**
 * Timesheet API domain types for read-only business tools (Phase 9.2).
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

export type TodayTimesheet = {
  date: string;
  entries: TimesheetEntry[];
  totalHours: number;
  remainingHours: number;
  /** Expected working hours for the day (default 8). */
  expectedHours: number;
  submitted: boolean;
};

export type WeekDaySummary = {
  date: string;
  totalHours: number;
  submitted?: boolean;
};

export type WeekTimesheet = {
  weekStart: string;
  weekEnd?: string;
  days: WeekDaySummary[];
  weeklyTotal: number;
  submitted: boolean;
  submissionStatus?: string;
};

/** Timesheet API REST paths used by Phase 9.2 read-only tools. */
export const TIMESHEET_API_PATHS = {
  workContext: '/v1/work-context',
  todayTimesheet: '/v1/timesheets/today',
  weekTimesheet: '/v1/timesheets/week',
} as const;

export const DEFAULT_EXPECTED_DAY_HOURS = 8;

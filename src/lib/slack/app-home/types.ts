/**
 * Slack App Home — presentation-safe types (no identity secrets in views).
 */

export type AppHomeOutcome =
  | 'ok'
  | 'empty'
  | 'partial'
  | 'identity_error'
  | 'dependency_error'
  | 'timesheet_error'
  | 'work_context_error';

export type AppHomeDayRow = {
  date: string;
  weekdayLabel: string;
  dateLabel: string;
  hours: number;
  isToday: boolean;
};

export type AppHomeProjectRow = {
  /** Display only — never used as identity or write input */
  clientName: string;
  projectName: string;
};

export type AppHomeTimesheetSection = {
  status: 'ok' | 'empty' | 'error';
  weekLabel: string;
  totalHours: number;
  days: AppHomeDayRow[];
};

export type AppHomeProjectsSection = {
  status: 'ok' | 'empty' | 'error';
  projects: AppHomeProjectRow[];
  extraCount: number;
};

export type AppHomeDashboardModel = {
  kind: 'dashboard';
  displayName?: string;
  timesheet: AppHomeTimesheetSection;
  projects: AppHomeProjectsSection;
  timesheetUrl?: string;
  showHelpExpanded?: boolean;
};

export type AppHomeErrorModel = {
  kind: 'identity_error' | 'dependency_error';
  timesheetUrl?: string;
};

export type AppHomeLoadingModel = {
  kind: 'loading';
};

export type AppHomeViewModel =
  | AppHomeDashboardModel
  | AppHomeErrorModel
  | AppHomeLoadingModel;

export type AppHomeLoadResult = {
  model: AppHomeViewModel;
  identityOutcome: 'ok' | 'failed';
  timesheetOutcome: 'ok' | 'empty' | 'failed' | 'skipped';
  workContextOutcome: 'ok' | 'empty' | 'failed' | 'skipped';
};

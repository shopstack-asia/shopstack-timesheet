/** Stable Block Kit / action ids for Slack App Home (no identity). */

export const EVENT_APP_HOME_OPENED = 'app_home_opened';

export const APP_HOME_ACTION = {
  refresh: 'app_home_refresh',
  openTimesheet: 'app_home_open_timesheet',
  help: 'app_home_help',
  retry: 'app_home_retry',
} as const;

export const APP_HOME_BLOCK = {
  header: 'app_home_header',
  greeting: 'app_home_greeting',
  weekSummary: 'app_home_week_summary',
  dailyHours: 'app_home_daily_hours',
  projects: 'app_home_projects',
  commands: 'app_home_commands',
  actions: 'app_home_actions',
  safety: 'app_home_safety',
  notice: 'app_home_notice',
  error: 'app_home_error',
  loading: 'app_home_loading',
} as const;

/** Button value constants — non-sensitive only */
export const APP_HOME_VALUE = {
  refresh: 'refresh',
  help: 'help',
  retry: 'retry',
} as const;

export const APP_HOME_MAX_PROJECTS = 5;
export const APP_HOME_MAX_BLOCKS = 90;
export const APP_HOME_MAX_SECTION_TEXT = 2900;
export const APP_HOME_LOADING_DELAY_MS = 700;

export function buildAppHomeConversationId(slackUserId: string): string {
  return `slack:app_home:${slackUserId.trim()}`;
}

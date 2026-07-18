import type { Tool, ToolContext } from '@/lib/tools/types';
import {
  toolFailureFromError,
  toolSuccess,
  type BusinessToolDeps,
} from '@/lib/tools/business/helpers';
import { bangkokToday } from '@/lib/tools/business/timesheet/bangkok-dates';
import { loadDailyTimesheet } from '@/lib/tools/business/timesheet/get-timesheet';

export { parseTodayTimesheet } from '@/lib/tools/business/timesheet/parse-timesheet';

/**
 * @deprecated Prefer get_timesheet with an explicit YYYY-MM-DD date.
 * Compatibility wrapper: loads Bangkok "today" via shared daily implementation.
 * Not registered in the AI-visible tool registry.
 */
export function createGetTodayTimesheetTool(deps?: BusinessToolDeps): Tool {
  return {
    name: 'get_today_timesheet',
    description:
      '[Deprecated] Use get_timesheet with today resolved to YYYY-MM-DD in Asia/Bangkok.',
    version: '2.0.0-deprecated',
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute(input, context: ToolContext) {
      const started = Date.now();
      try {
        void input;
        const day = await loadDailyTimesheet(deps, bangkokToday(), context);
        return toolSuccess('get_today_timesheet', started, day);
      } catch (error) {
        return toolFailureFromError('get_today_timesheet', started, error);
      }
    },
  };
}

export const getTodayTimesheetTool = createGetTodayTimesheetTool();

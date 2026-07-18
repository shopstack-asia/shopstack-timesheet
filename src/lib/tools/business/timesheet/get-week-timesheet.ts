import type { Tool, ToolContext } from '@/lib/tools/types';
import {
  toolFailureFromError,
  toolSuccess,
  type BusinessToolDeps,
} from '@/lib/tools/business/helpers';
import { bangkokCurrentWeek } from '@/lib/tools/business/timesheet/bangkok-dates';
import { loadTimesheetRange } from '@/lib/tools/business/timesheet/get-timesheet-range';

export { parseWeekTimesheet } from '@/lib/tools/business/timesheet/parse-week';

/**
 * @deprecated Prefer get_timesheet_range with explicit ISO start/end.
 * Compatibility wrapper: loads Bangkok current week (Mon–today) via shared range implementation.
 * Not registered in the AI-visible tool registry.
 */
export function createGetWeekTimesheetTool(deps?: BusinessToolDeps): Tool {
  return {
    name: 'get_week_timesheet',
    description:
      '[Deprecated] Use get_timesheet_range with this week resolved to YYYY-MM-DD dates in Asia/Bangkok.',
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
        const { startDate, endDate } = bangkokCurrentWeek();
        const range = await loadTimesheetRange(
          deps,
          startDate,
          endDate,
          context
        );
        return toolSuccess('get_week_timesheet', started, {
          weekStart: range.startDate,
          weekEnd: range.endDate,
          days: range.days.map((d) => ({
            date: d.date,
            totalHours: d.totalHours,
            submitted: d.submitted,
          })),
          weeklyTotal: range.totalHours,
          submitted: range.unsubmittedDays === 0 && range.days.length > 0,
          employeeId: range.employeeId,
        });
      } catch (error) {
        return toolFailureFromError('get_week_timesheet', started, error);
      }
    },
  };
}

export const getWeekTimesheetTool = createGetWeekTimesheetTool();

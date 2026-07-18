import { AgentAuthContext } from '@/lib/timesheet/agent-auth';
import {
  clearDayTimesheetForStaff,
  getWeeklyTimesheetForStaff,
  submitDayTimesheetForStaff,
} from '@/lib/timesheet/timesheet-service';
import {
  getCurrentEmployee,
  getHolidaysForStaff,
  getLeaveMonthlyForStaff,
  listProjectsForAgent,
  listTasksForAgent,
} from '@/lib/timesheet/master-service';
import { weekStartMonday } from '@/lib/timesheet-agent/dates';

/**
 * Internal Timesheet tools (MCP-ready adapters over existing services).
 */
export const timesheetTools = {
  async get_current_employee(ctx: AgentAuthContext) {
    return getCurrentEmployee(ctx);
  },
  async list_projects() {
    return listProjectsForAgent();
  },
  async list_tasks() {
    return listTasksForAgent();
  },
  async get_weekly_timesheet(ctx: AgentAuthContext, weekStart: string) {
    return getWeeklyTimesheetForStaff(ctx, weekStart);
  },
  async get_weekly_timesheet_for_date(ctx: AgentAuthContext, dateYmd: string) {
    return getWeeklyTimesheetForStaff(ctx, weekStartMonday(dateYmd));
  },
  async get_holidays(ctx: AgentAuthContext, year: number) {
    return getHolidaysForStaff(ctx, year);
  },
  async get_leave_monthly(ctx: AgentAuthContext, year: number, month: number) {
    return getLeaveMonthlyForStaff(ctx, year, month);
  },
  async submit_day_timesheet(
    ctx: AgentAuthContext,
    date: string,
    entries: Array<{ projectId: string; taskId: string; hours: number }>
  ) {
    // Agent conversation already required OVERRIDE / YES acknowledgments.
    return submitDayTimesheetForStaff(ctx, date, entries, {
      allowCustomProject: false,
      leaveOverride: true,
      holidayAcknowledged: true,
      futureAcknowledged: true,
      over24Acknowledged: true,
    });
  },
  async clear_day_timesheet(ctx: AgentAuthContext, date: string) {
    return clearDayTimesheetForStaff(ctx, date, { allowCustomProject: false });
  },
};

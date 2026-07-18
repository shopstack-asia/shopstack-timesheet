import { getCachedProjects, getCachedTasks } from '@/lib/google-sheets';
import { getCachedHolidays } from '@/lib/holiday-cache';
import { getZohoPeopleService } from '@/lib/zoho-people';
import { normalizeZohoLeaveRecords } from '@/lib/leave-utils';
import { getRedisClient } from '@/lib/redis';
import { format } from 'date-fns';
import { Holiday, LeaveDayEntry, Project, Task, ZohoLeaveApiResponse } from '@/types';
import { AgentAuthContext, assertAgentAuth } from '@/lib/timesheet/agent-auth';

export async function listProjectsForAgent(): Promise<{
  projects: Project[];
  clients: string[];
}> {
  const projects = await getCachedProjects();
  const clients = Array.from(
    new Set(projects.map((p) => p.ProjectClient).filter((c) => c))
  ).sort();
  return { projects, clients };
}

export async function listTasksForAgent(): Promise<Task[]> {
  return getCachedTasks();
}

export async function getLeaveMonthlyForStaff(
  ctx: AgentAuthContext,
  year: number,
  month: number
): Promise<LeaveDayEntry[]> {
  assertAgentAuth(ctx);
  // month is 1-12
  if (Number.isNaN(year) || year < 2000) {
    throw new Error('Invalid year parameter');
  }
  if (Number.isNaN(month) || month < 1 || month > 12) {
    throw new Error('Invalid month parameter (should be 1-12)');
  }

  const fromDate = format(new Date(year, month - 1, 1), 'yyyy-MM-dd');
  const lastDay = new Date(year, month, 0).getDate();
  const toDate = format(new Date(year, month - 1, lastDay), 'yyyy-MM-dd');
  const employeeId = ctx.staff.EmployeeID;
  const redis = getRedisClient();
  const cacheKey = `leave:${employeeId}:${fromDate}:${toDate}`;

  try {
    const cached = await redis.get<ZohoLeaveApiResponse>(cacheKey);
    if (cached) {
      return normalizeZohoLeaveRecords(cached);
    }
  } catch {
    // continue
  }

  const zohoService = getZohoPeopleService();
  const apiResponse = await zohoService.fetchLeaveRecords(employeeId, fromDate, toDate);

  try {
    await redis.setex(cacheKey, 21600, JSON.stringify(apiResponse));
  } catch {
    // ignore
  }

  return normalizeZohoLeaveRecords(apiResponse);
}

function resolveHolidayLocation(ctx: AgentAuthContext): string {
  const trimmed = ctx.staff.Location?.trim();
  if (trimmed) return trimmed;
  return (
    process.env.ZOHO_DEFAULT_LOCATION ||
    process.env.NEXT_PUBLIC_ZOHO_HOLIDAY_LOCATION ||
    process.env.NEXT_PUBLIC_DEFAULT_LOCATION ||
    ''
  );
}

export async function getHolidaysForStaff(
  ctx: AgentAuthContext,
  year: number
): Promise<Holiday[]> {
  assertAgentAuth(ctx);
  if (Number.isNaN(year) || year < 2000) {
    throw new Error('Invalid year parameter');
  }
  const location = resolveHolidayLocation(ctx);
  return getCachedHolidays(location || undefined, year);
}

export async function getCurrentEmployee(ctx: AgentAuthContext) {
  assertAgentAuth(ctx);
  return ctx.staff;
}

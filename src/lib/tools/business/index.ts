import { getWorkContextTool } from '@/lib/tools/business/context/get-work-context';
import { getMyProfileTool } from '@/lib/tools/business/profile/get-my-profile';
import { getTimesheetTool } from '@/lib/tools/business/timesheet/get-timesheet';
import { getTimesheetRangeTool } from '@/lib/tools/business/timesheet/get-timesheet-range';
import { BUSINESS_WRITE_TOOLS } from '@/lib/tools/business/timesheet-write';
import type { Tool } from '@/lib/tools/types';

export * from '@/lib/tools/business/types';
export * from '@/lib/tools/business/helpers';
export * from '@/lib/tools/business/context/get-work-context';
export * from '@/lib/tools/business/profile/get-my-profile';
export * from '@/lib/tools/business/timesheet/get-timesheet';
export * from '@/lib/tools/business/timesheet/get-timesheet-range';
export * from '@/lib/tools/business/timesheet/get-today-timesheet';
export * from '@/lib/tools/business/timesheet/get-week-timesheet';
export * from '@/lib/tools/business/timesheet-write';

/** AI-visible read-only business tools. */
export const BUSINESS_READ_TOOLS: Tool[] = [
  getMyProfileTool,
  getWorkContextTool,
  getTimesheetTool,
  getTimesheetRangeTool,
];

/** AI-visible business tools (read + confirmation-gated write). */
export const BUSINESS_TOOLS: Tool[] = [
  ...BUSINESS_READ_TOOLS,
  ...BUSINESS_WRITE_TOOLS,
];

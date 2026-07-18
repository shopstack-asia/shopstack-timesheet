import { getWorkContextTool } from '@/lib/tools/business/context/get-work-context';
import { getTimesheetTool } from '@/lib/tools/business/timesheet/get-timesheet';
import { getTimesheetRangeTool } from '@/lib/tools/business/timesheet/get-timesheet-range';
import type { Tool } from '@/lib/tools/types';

export * from '@/lib/tools/business/types';
export * from '@/lib/tools/business/helpers';
export * from '@/lib/tools/business/context/get-work-context';
export * from '@/lib/tools/business/timesheet/get-timesheet';
export * from '@/lib/tools/business/timesheet/get-timesheet-range';
export * from '@/lib/tools/business/timesheet/get-today-timesheet';
export * from '@/lib/tools/business/timesheet/get-week-timesheet';

/** AI-visible read-only business tools (generic date / range queries). */
export const BUSINESS_READ_TOOLS: Tool[] = [
  getWorkContextTool,
  getTimesheetTool,
  getTimesheetRangeTool,
];

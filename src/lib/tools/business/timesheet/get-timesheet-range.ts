import type { Tool, ToolContext, ToolResult } from '@/lib/tools/types';
import {
  assertNotAborted,
  rejectAiEmployeeId,
  requireConversationIds,
  resolveBusinessClient,
  resolveContextManager,
  requestMeta,
  toolFailureFromError,
  toolSuccess,
  type BusinessToolDeps,
} from '@/lib/tools/business/helpers';
import {
  assertValidDateRange,
  parseRequiredIsoDate,
} from '@/lib/tools/business/timesheet/date-input';
import { parseTimesheetRange } from '@/lib/tools/business/timesheet/parse-timesheet-range';
import { TIMESHEET_API_PATHS } from '@/lib/tools/business/types';
import type { TimesheetRange } from '@/lib/tools/business/types';

export { parseTimesheetRange } from '@/lib/tools/business/timesheet/parse-timesheet-range';

const TOOL_NAME = 'get_timesheet_range';

/**
 * Shared range load. Used by get_timesheet_range and deprecated get_week_timesheet.
 */
export async function loadTimesheetRange(
  deps: BusinessToolDeps | undefined,
  startDate: string,
  endDate: string,
  context: ToolContext
): Promise<TimesheetRange & { employeeId: string }> {
  assertNotAborted(context.signal);
  assertValidDateRange(startDate, endDate);

  const { conversationId, slackUserId } = requireConversationIds(context);
  const manager = resolveContextManager(deps);
  const conv = await manager.getConversationContext({
    conversationId,
    slackUserId,
    requestId: context.requestId,
    signal: context.signal,
    ensureWorkContext: false,
  });

  const client = resolveBusinessClient(deps);
  const qs = new URLSearchParams({ startDate, endDate });
  const path = `${TIMESHEET_API_PATHS.timesheets}?${qs.toString()}`;
  const response = await client.get<unknown>(path, {
    ...requestMeta(context, conv.employeeId),
    idempotent: true,
  });
  const range = parseTimesheetRange(response.data, startDate, endDate);
  return { ...range, employeeId: conv.employeeId };
}

export async function executeGetTimesheetRange(
  deps: BusinessToolDeps | undefined,
  input: Record<string, unknown>,
  context: ToolContext,
  toolName: string = TOOL_NAME
): Promise<ToolResult> {
  const started = Date.now();
  try {
    assertNotAborted(context.signal);
    rejectAiEmployeeId(input);
    const startDate = parseRequiredIsoDate(input.startDate, 'startDate');
    const endDate = parseRequiredIsoDate(input.endDate, 'endDate');
    const range = await loadTimesheetRange(deps, startDate, endDate, context);
    return toolSuccess(toolName, started, range);
  } catch (error) {
    return toolFailureFromError(toolName, started, error);
  }
}

export function createGetTimesheetRangeTool(deps?: BusinessToolDeps): Tool {
  return {
    name: TOOL_NAME,
    description: [
      'Return timesheet data for an inclusive date range (YYYY-MM-DD start/end, max 31 days).',
      'Resolve relative ranges (this week, last week, this month) to explicit ISO dates in Asia/Bangkok before calling.',
      'Never pass employeeId. Never pass relative date words.',
      'Example: "how many hours this week?" → Monday–today Bangkok → get_timesheet_range({ startDate, endDate }).',
      'Read-only — does not create or modify entries.',
    ].join(' '),
    version: '1.0.0',
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Inclusive start date YYYY-MM-DD',
        },
        endDate: {
          type: 'string',
          description: 'Inclusive end date YYYY-MM-DD',
        },
      },
      required: ['startDate', 'endDate'],
      additionalProperties: false,
    },
    async execute(input, context: ToolContext) {
      return executeGetTimesheetRange(deps, input, context, TOOL_NAME);
    },
  };
}

export const getTimesheetRangeTool = createGetTimesheetRangeTool();

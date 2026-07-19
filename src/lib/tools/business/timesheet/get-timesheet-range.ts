import type { Tool, ToolContext, ToolResult } from '@/lib/tools/types';
import {
  assertNotAborted,
  rejectAiEmployeeId,
  requireConversationIds,
  resolveContextManager,
  toolFailureFromError,
  toolSuccess,
  type BusinessToolDeps,
} from '@/lib/tools/business/helpers';
import {
  assertValidDateRange,
  parseRequiredIsoDate,
} from '@/lib/tools/business/timesheet/date-input';
import { parseTimesheetRange } from '@/lib/tools/business/timesheet/parse-timesheet-range';
import { readTimesheetRangeForEmployee } from '@/lib/timesheet/canonical-read';
import type { TimesheetRange } from '@/lib/tools/business/types';

export { parseTimesheetRange } from '@/lib/tools/business/timesheet/parse-timesheet-range';

const TOOL_NAME = 'get_timesheet_range';

/**
 * Shared range load via canonical Google Sheets Time Log read.
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

  const read = deps?.readTimesheetRange ?? readTimesheetRangeForEmployee;
  const range = await read(
    {
      employeeId: conv.employeeId,
      email: conv.slackEmail,
      slackUserId: conv.slackUserId,
    },
    startDate,
    endDate,
    {
      requestId: context.requestId,
      conversationId,
    }
  );

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
      'Reads the same Google Sheets Time Log data as the Weekly Timesheet UI.',
      'Resolve relative ranges to explicit ISO dates in Asia/Bangkok before calling.',
      'Never pass employeeId. Never pass relative date words.',
      'Empty days mean no work was logged (not an API failure).',
      'Read-only — does not create or modify entries.',
    ].join(' '),
    version: '2.0.0',
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

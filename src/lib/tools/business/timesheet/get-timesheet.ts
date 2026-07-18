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
import { parseRequiredIsoDate } from '@/lib/tools/business/timesheet/date-input';
import { parseDailyTimesheet } from '@/lib/tools/business/timesheet/parse-timesheet';
import { TIMESHEET_API_PATHS } from '@/lib/tools/business/types';

export { parseDailyTimesheet } from '@/lib/tools/business/timesheet/parse-timesheet';

const TOOL_NAME = 'get_timesheet';

/**
 * Shared daily timesheet load (Conversation Context identity + Timesheet API).
 * Used by get_timesheet and deprecated get_today_timesheet wrapper.
 */
export async function loadDailyTimesheet(
  deps: BusinessToolDeps | undefined,
  date: string,
  context: ToolContext
): Promise<{
  date: string;
  entries: ReturnType<typeof parseDailyTimesheet>['entries'];
  totalHours: number;
  expectedHours: number;
  remainingHours: number;
  submitted: boolean;
  employeeId: string;
}> {
  assertNotAborted(context.signal);
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
  const path = `${TIMESHEET_API_PATHS.timesheets}?date=${encodeURIComponent(date)}`;
  const response = await client.get<unknown>(path, {
    ...requestMeta(context, conv.employeeId),
    idempotent: true,
  });
  const day = parseDailyTimesheet(response.data);
  return { ...day, employeeId: conv.employeeId };
}

export async function executeGetTimesheet(
  deps: BusinessToolDeps | undefined,
  input: Record<string, unknown>,
  context: ToolContext,
  toolName: string = TOOL_NAME
): Promise<ToolResult> {
  const started = Date.now();
  try {
    assertNotAborted(context.signal);
    rejectAiEmployeeId(input);
    const date = parseRequiredIsoDate(input.date, 'date');
    const day = await loadDailyTimesheet(deps, date, context);
    return toolSuccess(toolName, started, day);
  } catch (error) {
    return toolFailureFromError(toolName, started, error);
  }
}

export function createGetTimesheetTool(deps?: BusinessToolDeps): Tool {
  return {
    name: TOOL_NAME,
    description: [
      'Return timesheet entries for one calendar date (YYYY-MM-DD) for the resolved conversation employee.',
      'Resolve relative phrases (today, yesterday, Thai equivalents) to YYYY-MM-DD in Asia/Bangkok before calling.',
      'Never pass employeeId. Never pass relative date words.',
      'Example: User asks what they logged yesterday → resolve Bangkok yesterday → get_timesheet({ date }).',
      'Read-only — does not create or modify entries.',
    ].join(' '),
    version: '1.0.0',
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Calendar date as YYYY-MM-DD (Asia/Bangkok resolved by the AI)',
        },
      },
      required: ['date'],
      additionalProperties: false,
    },
    async execute(input, context: ToolContext) {
      return executeGetTimesheet(deps, input, context, TOOL_NAME);
    },
  };
}

export const getTimesheetTool = createGetTimesheetTool();

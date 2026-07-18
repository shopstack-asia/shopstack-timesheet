import type { Tool, ToolContext } from '@/lib/tools/types';
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
  CS_CORE_PATHS,
} from '@/lib/tools/business/types';
import { parseTodayTimesheet } from '@/lib/tools/business/timesheet/parse-today';

export { parseTodayTimesheet } from '@/lib/tools/business/timesheet/parse-today';

export function createGetTodayTimesheetTool(deps?: BusinessToolDeps): Tool {
  return {
    name: 'get_today_timesheet',
    description: [
      "Return today's timesheet for the resolved conversation employee: entries, total hours, remaining hours, submitted status.",
      'Uses Conversation Context for identity — never pass employeeId.',
      'Example: User says "What did I log today?" → call get_today_timesheet.',
      'Read-only — does not create or modify entries.',
    ].join(' '),
    version: '1.1.0',
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute(input, context: ToolContext) {
      const started = Date.now();
      try {
        assertNotAborted(context.signal);
        rejectAiEmployeeId(input);

        const { conversationId, slackUserId } =
          requireConversationIds(context);
        const manager = resolveContextManager(deps);
        const conv = await manager.getConversationContext({
          conversationId,
          slackUserId,
          requestId: context.requestId,
          signal: context.signal,
          ensureWorkContext: false,
        });

        const client = resolveBusinessClient(deps);
        const response = await client.get<unknown>(
          CS_CORE_PATHS.todayTimesheet,
          {
            ...requestMeta(context, conv.employeeId),
            idempotent: true,
          }
        );
        const today = parseTodayTimesheet(response.data);
        return toolSuccess('get_today_timesheet', started, {
          ...today,
          employeeId: conv.employeeId,
        });
      } catch (error) {
        return toolFailureFromError('get_today_timesheet', started, error);
      }
    },
  };
}

export const getTodayTimesheetTool = createGetTodayTimesheetTool();

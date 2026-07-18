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
import { CS_CORE_PATHS } from '@/lib/tools/business/types';
import { parseWeekTimesheet } from '@/lib/tools/business/timesheet/parse-week';

export { parseWeekTimesheet } from '@/lib/tools/business/timesheet/parse-week';

export function createGetWeekTimesheetTool(deps?: BusinessToolDeps): Tool {
  return {
    name: 'get_week_timesheet',
    description: [
      'Return the current week timesheet summary for the resolved conversation employee.',
      'Uses Conversation Context for identity — never pass employeeId.',
      'Example: User says "How many hours this week?" → call get_week_timesheet.',
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
          CS_CORE_PATHS.weekTimesheet,
          {
            ...requestMeta(context, conv.employeeId),
            idempotent: true,
          }
        );
        const week = parseWeekTimesheet(response.data);
        return toolSuccess('get_week_timesheet', started, {
          ...week,
          employeeId: conv.employeeId,
        });
      } catch (error) {
        return toolFailureFromError('get_week_timesheet', started, error);
      }
    },
  };
}

export const getWeekTimesheetTool = createGetWeekTimesheetTool();

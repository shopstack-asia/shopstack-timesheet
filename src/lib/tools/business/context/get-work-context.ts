import type { Tool, ToolContext } from '@/lib/tools/types';
import {
  assertNotAborted,
  rejectAiEmployeeId,
  requireConversationIds,
  resolveContextManager,
  toolFailureFromError,
  toolSuccess,
  type BusinessToolDeps,
} from '@/lib/tools/business/helpers';
import { buildSelectionHints } from '@/lib/tools/business/context/selection-hints';
import { parseWorkContext } from '@/lib/tools/business/context/work-context-parse';
import { ToolError } from '@/lib/tools/errors';

export { parseWorkContext } from '@/lib/tools/business/context/work-context-parse';
export { buildSelectionHints } from '@/lib/tools/business/context/selection-hints';

export function createGetWorkContextTool(deps?: BusinessToolDeps): Tool {
  return {
    name: 'get_work_context',
    description: [
      'Load (or reuse cached) work context for the current Slack conversation: user + clients → projects → roles.',
      'Uses Conversation Context — do not pass employeeId. Call once per conversation; set refresh=true only to force reload.',
      'Optional selectedClientId / selectedProjectId / selectedRoleId update conversation selection with invalidation rules.',
      'Auto-select Client/Project/Role only when exactly one of each exists; otherwise ask the user. Never guess.',
      'Read-only phase: do not create timesheets after this tool.',
    ].join(' '),
    version: '1.1.0',
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        refresh: {
          type: 'boolean',
          description:
            'When true, reload work context from Timesheet API and clear selected client/project/role',
        },
        selectedClientId: {
          type: 'string',
          description:
            'Persist selected client in conversation context (clears project and role)',
        },
        selectedProjectId: {
          type: 'string',
          description:
            'Persist selected project in conversation context (clears role)',
        },
        selectedRoleId: {
          type: 'string',
          description: 'Persist selected role in conversation context',
        },
      },
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
        const refresh = input.refresh === true;

        let conv = await manager.getConversationContext({
          conversationId,
          slackUserId,
          requestId: context.requestId,
          signal: context.signal,
          ensureWorkContext: true,
          forceRefreshWorkContext: refresh,
        });

        const workContext = conv.workContext;
        if (!workContext) {
          throw new ToolError('Work context missing after load', 'unexpected');
        }

        const selectedClientId =
          typeof input.selectedClientId === 'string'
            ? input.selectedClientId.trim()
            : '';
        if (selectedClientId) {
          const client = workContext.clients.find(
            (c) => c.id === selectedClientId
          );
          if (!client) {
            throw new ToolError(
              `Unknown client id: ${selectedClientId}`,
              'validation_error'
            );
          }
          conv = manager.selectClient(conversationId, {
            id: client.id,
            name: client.name,
          });
        }

        const selectedProjectId =
          typeof input.selectedProjectId === 'string'
            ? input.selectedProjectId.trim()
            : '';
        if (selectedProjectId) {
          const clientId = conv.selectedClient?.id;
          const client = workContext.clients.find((c) => c.id === clientId);
          const project = client?.projects.find(
            (p) => p.id === selectedProjectId
          );
          if (!project) {
            throw new ToolError(
              `Unknown project id: ${selectedProjectId}`,
              'validation_error'
            );
          }
          conv = manager.selectProject(conversationId, {
            id: project.id,
            name: project.name,
          });
        }

        const selectedRoleId =
          typeof input.selectedRoleId === 'string'
            ? input.selectedRoleId.trim()
            : '';
        if (selectedRoleId) {
          const client = workContext.clients.find(
            (c) => c.id === conv.selectedClient?.id
          );
          const project = client?.projects.find(
            (p) => p.id === conv.selectedProject?.id
          );
          const role = project?.roles.find((r) => r.id === selectedRoleId);
          if (!role) {
            throw new ToolError(
              `Unknown role id: ${selectedRoleId}`,
              'validation_error'
            );
          }
          conv = manager.selectRole(conversationId, {
            id: role.id,
            name: role.name,
          });
        }

        const selection = buildSelectionHints(workContext);
        return toolSuccess('get_work_context', started, {
          ...workContext,
          selection,
          selectedClient: conv.selectedClient ?? null,
          selectedProject: conv.selectedProject ?? null,
          selectedRole: conv.selectedRole ?? null,
          employeeId: conv.employeeId,
          refreshed: refresh,
        });
      } catch (error) {
        return toolFailureFromError('get_work_context', started, error);
      }
    },
  };
}

export const getWorkContextTool = createGetWorkContextTool();

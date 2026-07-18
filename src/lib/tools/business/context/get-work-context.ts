import type { Tool, ToolContext } from '@/lib/tools/types';
import {
  assertNotAborted,
  isPlainObject,
  requestMeta,
  requireString,
  resolveBusinessClient,
  toolFailureFromError,
  toolSuccess,
  type BusinessToolDeps,
} from '@/lib/tools/business/helpers';
import {
  CS_CORE_PATHS,
  type WorkClient,
  type WorkContext,
  type WorkProject,
  type WorkRole,
} from '@/lib/tools/business/types';
import { ToolError } from '@/lib/tools/errors';

function parseRole(raw: unknown): WorkRole {
  if (!isPlainObject(raw)) {
    throw new ToolError('Malformed response: invalid role', 'validation_error');
  }
  return {
    id: requireString(raw, 'id', 'role.id'),
    name: requireString(raw, 'name', 'role.name'),
  };
}

function parseProject(raw: unknown): WorkProject {
  if (!isPlainObject(raw)) {
    throw new ToolError(
      'Malformed response: invalid project',
      'validation_error'
    );
  }
  const rolesRaw = raw.roles;
  if (!Array.isArray(rolesRaw)) {
    throw new ToolError(
      'Malformed response: project.roles must be an array',
      'validation_error'
    );
  }
  return {
    id: requireString(raw, 'id', 'project.id'),
    name: requireString(raw, 'name', 'project.name'),
    roles: rolesRaw.map(parseRole),
  };
}

function parseClient(raw: unknown): WorkClient {
  if (!isPlainObject(raw)) {
    throw new ToolError(
      'Malformed response: invalid client',
      'validation_error'
    );
  }
  const projectsRaw = raw.projects;
  if (!Array.isArray(projectsRaw)) {
    throw new ToolError(
      'Malformed response: client.projects must be an array',
      'validation_error'
    );
  }
  return {
    id: requireString(raw, 'id', 'client.id'),
    name: requireString(raw, 'name', 'client.name'),
    projects: projectsRaw.map(parseProject),
  };
}

/** Normalize CS-Core work-context payload into WorkContext. */
export function parseWorkContext(data: unknown): WorkContext {
  if (!isPlainObject(data)) {
    throw new ToolError(
      'Malformed response: work context must be an object',
      'validation_error'
    );
  }
  if (!isPlainObject(data.user)) {
    throw new ToolError(
      'Malformed response: missing user',
      'validation_error'
    );
  }
  if (!Array.isArray(data.clients)) {
    throw new ToolError(
      'Malformed response: clients must be an array',
      'validation_error'
    );
  }
  return {
    user: {
      id: requireString(data.user, 'id', 'user.id'),
      name: requireString(data.user, 'name', 'user.name'),
    },
    clients: data.clients.map(parseClient),
  };
}

/**
 * Selection hint for the AI (not stored permanently).
 * Auto-select only when exactly one client / project / role path exists.
 */
export function buildSelectionHints(context: WorkContext): {
  autoSelectable: boolean;
  singleClient?: { id: string; name: string };
  singleProject?: { id: string; name: string };
  singleRole?: { id: string; name: string };
  message: string;
} {
  if (context.clients.length !== 1) {
    return {
      autoSelectable: false,
      message:
        context.clients.length === 0
          ? 'No clients available. Ask the user for guidance.'
          : 'Multiple clients available. Ask the user which client to use. Never guess.',
    };
  }
  const client = context.clients[0]!;
  if (client.projects.length !== 1) {
    return {
      autoSelectable: false,
      singleClient: { id: client.id, name: client.name },
      message:
        client.projects.length === 0
          ? `Client ${client.name} has no projects. Ask the user.`
          : 'Multiple projects available. Ask the user which project to use. Never guess.',
    };
  }
  const project = client.projects[0]!;
  if (project.roles.length !== 1) {
    return {
      autoSelectable: false,
      singleClient: { id: client.id, name: client.name },
      singleProject: { id: project.id, name: project.name },
      message:
        project.roles.length === 0
          ? `Project ${project.name} has no roles. Ask the user.`
          : 'Multiple roles available. Ask the user which role to use. Never guess.',
    };
  }
  const role = project.roles[0]!;
  return {
    autoSelectable: true,
    singleClient: { id: client.id, name: client.name },
    singleProject: { id: project.id, name: project.name },
    singleRole: { id: role.id, name: role.name },
    message:
      'Exactly one client/project/role. You may auto-select these values. Do not create timesheet entries yet (write tools are not available in this phase).',
  };
}

export function createGetWorkContextTool(deps?: BusinessToolDeps): Tool {
  return {
    name: 'get_work_context',
    description: [
      'Load the current user work context required before logging time: user identity plus clients → projects → roles.',
      'Call this once when the user wants to log time and you need Client/Project/Role choices.',
      'Do not call multiple context tools — this returns the full hierarchy in one response.',
      'Auto-select Client/Project/Role only when exactly one of each exists; otherwise ask the user. Never guess.',
      'This phase is read-only: do not create or submit timesheets after calling this tool.',
      'Example: User says "Log 8 hours today" → call get_work_context → ask or auto-select → wait (no write).',
    ].join(' '),
    version: '1.0.0',
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute(_input, context: ToolContext) {
      const started = Date.now();
      try {
        assertNotAborted(context.signal);
        const client = resolveBusinessClient(deps);
        const response = await client.get<unknown>(CS_CORE_PATHS.workContext, {
          ...requestMeta(context),
          idempotent: true,
        });
        const workContext = parseWorkContext(response.data);
        const selection = buildSelectionHints(workContext);
        return toolSuccess('get_work_context', started, {
          ...workContext,
          selection,
        });
      } catch (error) {
        return toolFailureFromError('get_work_context', started, error);
      }
    },
  };
}

export const getWorkContextTool = createGetWorkContextTool();

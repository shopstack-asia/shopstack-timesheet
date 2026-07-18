import type { WorkContext } from '@/lib/tools/business/types';

/**
 * Selection hint for the AI (conversation memory only).
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

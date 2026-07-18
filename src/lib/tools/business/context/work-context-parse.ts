import {
  isPlainObject,
  requireString,
} from '@/lib/tools/business/helpers';
import type {
  WorkClient,
  WorkContext,
  WorkProject,
  WorkRole,
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

/** Normalize Timesheet API work-context payload into WorkContext. */
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

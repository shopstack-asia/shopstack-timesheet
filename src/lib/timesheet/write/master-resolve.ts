import { getCachedProjects, getCachedTasks } from '@/lib/google-sheets';
import type { Project, Task } from '@/types';

export type MasterResolveResult<T> =
  | { status: 'resolved'; value: T }
  | { status: 'ambiguous'; candidates: T[] }
  | { status: 'not_found' };

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function resolveProject(input: {
  projectId?: string;
  projectName?: string;
}): Promise<MasterResolveResult<Project>> {
  const projects = await getCachedProjects();
  const id = input.projectId?.trim();
  if (id) {
    const byId = projects.find((p) => p.ProjectID === id);
    if (byId) return { status: 'resolved', value: byId };
    return { status: 'not_found' };
  }
  const name = input.projectName?.trim();
  if (!name) return { status: 'not_found' };

  const n = norm(name);
  const exact = projects.filter(
    (p) =>
      norm(p.ProjectName) === n ||
      norm(p.ProjectCode) === n ||
      norm(`${p.ProjectName} (${p.ProjectCode})`) === n ||
      norm(p.ProjectClient) === n
  );
  if (exact.length === 1) return { status: 'resolved', value: exact[0]! };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact };

  const fuzzy = projects.filter(
    (p) =>
      norm(p.ProjectName).includes(n) ||
      norm(p.ProjectCode).includes(n) ||
      n.includes(norm(p.ProjectName)) ||
      norm(p.ProjectClient).includes(n)
  );
  if (fuzzy.length === 1) return { status: 'resolved', value: fuzzy[0]! };
  if (fuzzy.length > 1) return { status: 'ambiguous', candidates: fuzzy };
  return { status: 'not_found' };
}

export async function resolveTask(input: {
  taskId?: string;
  taskName?: string;
}): Promise<MasterResolveResult<Task>> {
  const tasks = await getCachedTasks();
  const id = input.taskId?.trim();
  if (id) {
    const byId = tasks.find((t) => t.TaskID === id);
    if (byId) return { status: 'resolved', value: byId };
    return { status: 'not_found' };
  }
  const name = input.taskName?.trim();
  if (!name) return { status: 'not_found' };
  const n = norm(name);
  const exact = tasks.filter((t) => norm(t.Task) === n);
  if (exact.length === 1) return { status: 'resolved', value: exact[0]! };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact };
  const fuzzy = tasks.filter(
    (t) => norm(t.Task).includes(n) || n.includes(norm(t.Task))
  );
  if (fuzzy.length === 1) return { status: 'resolved', value: fuzzy[0]! };
  if (fuzzy.length > 1) return { status: 'ambiguous', candidates: fuzzy };
  return { status: 'not_found' };
}

export function formatProjectLabel(p: Project): string {
  const name = p.ProjectName?.trim() || '';
  const code = p.ProjectCode?.trim() || '';
  if (name && code) return `${name} (${code})`;
  return name || code || p.ProjectID;
}

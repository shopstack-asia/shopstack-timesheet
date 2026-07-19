import { getCachedProjects, getCachedTasks } from '@/lib/google-sheets';
import type { Project, Task } from '@/types';

export type MasterResolveResult<T> =
  | { status: 'resolved'; value: T }
  | { status: 'ambiguous'; candidates: T[] }
  | { status: 'not_found' };

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Collapse Manager/Management/Mgr and punctuation for conservative matching. */
function stemToken(token: string): string {
  let t = norm(token).replace(/[^a-z0-9ก-๙]+/gi, '');
  if (!t) return '';
  t = t
    .replace(/management$/i, 'manage')
    .replace(/manager$/i, 'manage')
    .replace(/mgr$/i, 'manage')
    .replace(/developers?$/i, 'develop')
    .replace(/development$/i, 'develop')
    .replace(/testing$/i, 'test')
    .replace(/tester$/i, 'test');
  return t;
}

function tokens(s: string): string[] {
  return norm(s)
    .split(/[\s/_().\-]+/)
    .map(stemToken)
    .filter((t) => t.length > 0);
}

/** Initials of whitespace/punctuation-separated words (e.g. Project Management → pm). */
export function wordInitials(s: string): string {
  return norm(s)
    .split(/[\s/_().\-]+/)
    .filter(Boolean)
    .map((w) => w[0]!)
    .join('');
}

/** Compact alnum form without spaces (Raw Material… → rawmaterial…). */
function compact(s: string): string {
  return norm(s).replace(/[^a-z0-9ก-๙]+/gi, '');
}

function uniqueOrAmbiguous<T>(
  matches: T[],
  keyOf: (item: T) => string
): MasterResolveResult<T> {
  const dedup = [...new Map(matches.map((m) => [keyOf(m), m])).values()];
  if (dedup.length === 1) return { status: 'resolved', value: dedup[0]! };
  if (dedup.length > 1) return { status: 'ambiguous', candidates: dedup };
  return { status: 'not_found' };
}

function tokenSetMatch(hint: string, candidate: string): boolean {
  const ht = tokens(hint);
  const ct = tokens(candidate);
  if (ht.length === 0 || ct.length === 0) return false;
  // Every hint token must match a candidate token by equality or shared prefix (≥3)
  return ht.every((h) =>
    ct.some(
      (c) =>
        c === h ||
        (h.length >= 3 && c.startsWith(h)) ||
        (c.length >= 3 && h.startsWith(c))
    )
  );
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
      norm(p.ProjectClient) === n ||
      compact(p.ProjectCode) === compact(name)
  );
  if (exact.length === 1) return { status: 'resolved', value: exact[0]! };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact };

  // Unique abbreviation / initials (RMS, short codes as hints)
  const alias = projects.filter(
    (p) =>
      wordInitials(p.ProjectName) === n ||
      wordInitials(p.ProjectCode) === n ||
      (n.length >= 2 && compact(p.ProjectCode) === compact(name)) ||
      (n.length >= 2 && compact(p.ProjectCode).startsWith(compact(name))) ||
      (n.length >= 2 && norm(p.ProjectCode).startsWith(n)) ||
      (n.length >= 3 && norm(p.ProjectName).startsWith(n))
  );
  const aliasResult = uniqueOrAmbiguous(alias, (p) => p.ProjectID);
  if (aliasResult.status !== 'not_found') return aliasResult;

  const tokenHits = projects.filter(
    (p) =>
      tokenSetMatch(name, p.ProjectName) ||
      tokenSetMatch(name, p.ProjectCode) ||
      (p.ProjectClient ? tokenSetMatch(name, p.ProjectClient) : false)
  );
  const tokenResult = uniqueOrAmbiguous(tokenHits, (p) => p.ProjectID);
  if (tokenResult.status !== 'not_found') return tokenResult;

  const fuzzy = projects.filter(
    (p) =>
      norm(p.ProjectName).includes(n) ||
      norm(p.ProjectCode).includes(n) ||
      (n.length >= 4 && n.includes(norm(p.ProjectName))) ||
      norm(p.ProjectClient).includes(n) ||
      compact(p.ProjectName).includes(compact(name))
  );
  return uniqueOrAmbiguous(fuzzy, (p) => p.ProjectID);
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

  // Unique abbreviation (PM → Project Management, Dev → Development)
  const alias = tasks.filter(
    (t) =>
      wordInitials(t.Task) === n ||
      (n.length >= 2 && n.length <= 4 && wordInitials(t.Task) === n) ||
      (n.length >= 3 && norm(t.Task).startsWith(n))
  );
  const aliasResult = uniqueOrAmbiguous(alias, (t) => t.TaskID);
  if (aliasResult.status !== 'not_found') return aliasResult;

  // Token/stem match: "Project Manager" → "Project Management"
  const tokenHits = tasks.filter((t) => tokenSetMatch(name, t.Task));
  const tokenResult = uniqueOrAmbiguous(tokenHits, (t) => t.TaskID);
  if (tokenResult.status !== 'not_found') return tokenResult;

  // Conservative fuzzy: only when hint length >= 3
  if (n.length >= 3) {
    const fuzzy = tasks.filter(
      (t) =>
        norm(t.Task).includes(n) ||
        n.includes(norm(t.Task)) ||
        compact(t.Task).includes(compact(name))
    );
    return uniqueOrAmbiguous(fuzzy, (t) => t.TaskID);
  }
  return { status: 'not_found' };
}

export function formatProjectLabel(p: Project): string {
  const name = p.ProjectName?.trim() || '';
  const code = p.ProjectCode?.trim() || '';
  if (name && code) return `${name} (${code})`;
  return name || code || p.ProjectID;
}

export function formatTaskLabel(t: Task): string {
  return t.Task?.trim() || t.TaskID;
}

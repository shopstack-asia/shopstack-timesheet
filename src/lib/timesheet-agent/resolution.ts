import { Project, Task } from '@/types';

export type ProjectMatch = {
  project: Project;
  score: number;
  reason: string;
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function resolveProjects(query: string, projects: Project[]): ProjectMatch[] {
  const q = norm(query);
  if (!q) return [];

  const matches: ProjectMatch[] = [];

  for (const project of projects) {
    const id = norm(project.ProjectID);
    const code = norm(project.ProjectCode);
    const name = norm(project.ProjectName);
    const client = norm(project.ProjectClient);

    if (id === q) {
      matches.push({ project, score: 100, reason: 'exact_id' });
      continue;
    }
    if (code === q) {
      matches.push({ project, score: 90, reason: 'exact_code' });
      continue;
    }
    if (name === q) {
      matches.push({ project, score: 80, reason: 'exact_name' });
      continue;
    }
    if (name.includes(q) || q.includes(name)) {
      matches.push({ project, score: 60, reason: 'partial_name' });
      continue;
    }
    if (client === q) {
      matches.push({ project, score: 50, reason: 'exact_client' });
      continue;
    }
    if (client.includes(q) || code.includes(q)) {
      matches.push({ project, score: 40, reason: 'partial_client_or_code' });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}

export type ProjectResolution =
  | { status: 'exact'; project: Project }
  | { status: 'ambiguous'; candidates: Project[] }
  | { status: 'unknown'; similar: Project[] };

export function decideProjectResolution(
  query: string,
  projects: Project[]
): ProjectResolution {
  const matches = resolveProjects(query, projects);
  if (matches.length === 0) {
    const similar = projects
      .filter((p) => {
        const q = norm(query);
        return (
          norm(p.ProjectName).includes(q.slice(0, 3)) ||
          norm(p.ProjectClient).includes(q.slice(0, 3))
        );
      })
      .slice(0, 5);
    return { status: 'unknown', similar };
  }

  const top = matches[0];
  const topTier = matches.filter((m) => m.score === top.score);
  if (top.score >= 80 && topTier.length === 1) {
    return { status: 'exact', project: top.project };
  }
  if (top.score >= 60 && topTier.length === 1 && matches.filter((m) => m.score >= 60).length === 1) {
    return { status: 'exact', project: top.project };
  }

  const unique = new Map<string, Project>();
  for (const m of matches) {
    unique.set(m.project.ProjectID, m.project);
  }
  const candidates = Array.from(unique.values()).slice(0, 10);
  if (candidates.length === 1) {
    return { status: 'exact', project: candidates[0] };
  }
  return { status: 'ambiguous', candidates };
}

export type TaskResolution =
  | { status: 'exact'; task: Task }
  | { status: 'ambiguous'; candidates: Task[] }
  | { status: 'unknown' };

export function decideTaskResolution(query: string, tasks: Task[]): TaskResolution {
  const q = norm(query);
  if (!q) return { status: 'unknown' };

  const exactId = tasks.filter((t) => norm(t.TaskID) === q);
  if (exactId.length === 1) return { status: 'exact', task: exactId[0] };

  const exactName = tasks.filter((t) => norm(t.Task) === q);
  if (exactName.length === 1) return { status: 'exact', task: exactName[0] };
  if (exactName.length > 1) return { status: 'ambiguous', candidates: exactName.slice(0, 10) };

  const partial = tasks.filter((t) => norm(t.Task).includes(q) || q.includes(norm(t.Task)));
  if (partial.length === 1) return { status: 'exact', task: partial[0] };
  if (partial.length > 1) return { status: 'ambiguous', candidates: partial.slice(0, 10) };

  return { status: 'unknown' };
}

export function formatProjectOption(p: Project, index: number): string {
  return `${index}. ${p.ProjectName} (${p.ProjectCode}) · ${p.ProjectClient} · ID ${p.ProjectID}`;
}

export function formatTaskOption(t: Task, index: number): string {
  return `${index}. ${t.Task} · ID ${t.TaskID}`;
}

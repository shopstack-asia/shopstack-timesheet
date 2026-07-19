/**
 * Project list helpers for App Home (presentation only).
 */

import type { WorkContext } from '@/lib/tools/business/types';
import type { AppHomeProjectRow } from '@/lib/slack/app-home/types';
import { APP_HOME_MAX_PROJECTS } from '@/lib/slack/app-home/constants';

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Flatten clients→projects, dedupe by project id, sort by client then project name.
 * Returns at most {@link APP_HOME_MAX_PROJECTS} rows plus extraCount.
 */
export function selectAppHomeProjects(
  workContext: WorkContext | undefined | null
): { projects: AppHomeProjectRow[]; extraCount: number } {
  if (!workContext?.clients?.length) {
    return { projects: [], extraCount: 0 };
  }

  const byId = new Map<string, AppHomeProjectRow & { id: string }>();
  for (const client of workContext.clients) {
    const clientName = truncate(client.name || 'Client', 80);
    for (const project of client.projects || []) {
      const id = (project.id || '').trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        id,
        clientName,
        projectName: truncate(project.name || 'Project', 120),
      });
    }
  }

  const all = [...byId.values()].sort((a, b) => {
    const c = a.clientName.localeCompare(b.clientName, 'th');
    if (c !== 0) return c;
    return a.projectName.localeCompare(b.projectName, 'th');
  });

  const sliced = all.slice(0, APP_HOME_MAX_PROJECTS).map(({ clientName, projectName }) => ({
    clientName,
    projectName,
  }));
  return {
    projects: sliced,
    extraCount: Math.max(0, all.length - sliced.length),
  };
}

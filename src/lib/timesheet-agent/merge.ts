export type DayEntry = {
  projectId: string;
  taskId: string;
  hours: number;
};

export type DaySet = Map<string, DayEntry>;

export function dayKey(projectId: string, taskId: string): string {
  return `${projectId}|${taskId}`;
}

export function entriesToDaySet(
  entries: Array<{ projectId: string; taskId: string; hours: number }>
): DaySet {
  const map: DaySet = new Map();
  for (const e of entries) {
    map.set(dayKey(e.projectId, e.taskId), {
      projectId: e.projectId,
      taskId: e.taskId,
      hours: e.hours,
    });
  }
  return map;
}

export function daySetToEntries(daySet: DaySet): DayEntry[] {
  return Array.from(daySet.values());
}

export function dayTotal(daySet: DaySet): number {
  return Array.from(daySet.values()).reduce((s, e) => s + e.hours, 0);
}

export type MergeDuplicatePolicy = 'ask' | 'sum' | 'replace';

export type MergeAddResult =
  | { ok: true; daySet: DaySet; duplicate?: false }
  | { ok: true; daySet: DaySet; duplicate: true; existingHours: number; needsPolicy: true }
  | { ok: false; error: string };

export function mergeAdd(
  daySet: DaySet,
  entry: DayEntry,
  policy: MergeDuplicatePolicy = 'ask'
): MergeAddResult {
  if (!(entry.hours > 0) || entry.hours > 24) {
    return { ok: false, error: 'Hours must be greater than 0 and at most 24' };
  }
  const key = dayKey(entry.projectId, entry.taskId);
  const existing = daySet.get(key);
  if (existing) {
    if (policy === 'ask') {
      return {
        ok: true,
        daySet,
        duplicate: true,
        existingHours: existing.hours,
        needsPolicy: true,
      };
    }
    const next = new Map(daySet);
    next.set(key, {
      ...entry,
      hours: policy === 'sum' ? existing.hours + entry.hours : entry.hours,
    });
    const h = next.get(key)!.hours;
    if (h > 24) {
      return { ok: false, error: 'Combined hours for this project/task would exceed 24' };
    }
    return { ok: true, daySet: next, duplicate: false };
  }
  const next = new Map(daySet);
  next.set(key, entry);
  return { ok: true, daySet: next, duplicate: false };
}

export function mergeUpdate(
  daySet: DaySet,
  projectId: string,
  taskId: string,
  hours: number
): { ok: true; daySet: DaySet } | { ok: false; error: 'NOT_FOUND' | string } {
  if (!(hours > 0) || hours > 24) {
    return { ok: false, error: 'Hours must be greater than 0 and at most 24' };
  }
  const key = dayKey(projectId, taskId);
  if (!daySet.has(key)) {
    return { ok: false, error: 'NOT_FOUND' };
  }
  const next = new Map(daySet);
  next.set(key, { projectId, taskId, hours });
  return { ok: true, daySet: next };
}

export function mergeDelete(
  daySet: DaySet,
  projectId: string,
  taskId: string
): { ok: true; daySet: DaySet; becameEmpty: boolean } | { ok: false; error: 'NOT_FOUND' } {
  const key = dayKey(projectId, taskId);
  if (!daySet.has(key)) {
    return { ok: false, error: 'NOT_FOUND' };
  }
  const next = new Map(daySet);
  next.delete(key);
  return { ok: true, daySet: next, becameEmpty: next.size === 0 };
}

export function mergeClear(): DaySet {
  return new Map();
}

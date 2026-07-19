import { createHash } from 'crypto';
import type { DaySnapshot, SnapshotEntry } from '@/lib/timesheet/write/pending-types';

export type SnapshotBuildFailureReason =
  | 'invalid_date'
  | 'missing_project_id'
  | 'missing_task_id'
  | 'invalid_hours'
  | 'duplicate_entries';

export type SnapshotBuildResult =
  | { ok: true; snapshot: DaySnapshot }
  | {
      ok: false;
      reason: SnapshotBuildFailureReason;
      invalidEntryIndexes: number[];
    };

function sortKey(e: SnapshotEntry): string {
  return `${e.projectId}|${e.taskId}|${e.id || ''}`;
}

function contentKey(e: Pick<SnapshotEntry, 'projectId' | 'taskId' | 'hours'>): string {
  return `${e.projectId}|${e.taskId}|${e.hours}`;
}

/** Normalize a validated snapshot for hashing (sorted, no display labels). */
export function normalizeDaySnapshot(snapshot: DaySnapshot): DaySnapshot {
  const entries = [...snapshot.entries]
    .map((e) => ({
      id: e.id?.trim() || undefined,
      projectId: e.projectId.trim(),
      taskId: e.taskId.trim(),
      hours: e.hours,
    }))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return { date: snapshot.date, entries };
}

export function hashDaySnapshot(snapshot: DaySnapshot): string {
  const normalized = normalizeDaySnapshot(snapshot);
  const payload = JSON.stringify(normalized);
  return createHash('sha256').update(payload).digest('hex');
}

/** Content hash ignoring entry ids (for post-create read-back). */
export function hashDaySnapshotContent(snapshot: DaySnapshot): string {
  const normalized = {
    date: snapshot.date,
    entries: [...snapshot.entries]
      .map((e) => ({
        projectId: e.projectId.trim(),
        taskId: e.taskId.trim(),
        hours: e.hours,
      }))
      .sort((a, b) => contentKey(a).localeCompare(contentKey(b))),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function snapshotsEqual(a: DaySnapshot, b: DaySnapshot): boolean {
  return hashDaySnapshot(a) === hashDaySnapshot(b);
}

export function snapshotsContentEqual(a: DaySnapshot, b: DaySnapshot): boolean {
  return hashDaySnapshotContent(a) === hashDaySnapshotContent(b);
}

/**
 * Build a day snapshot without silently dropping incomplete entries.
 * Fail closed so whole-day replace cannot omit existing Sheets rows.
 */
export function buildDaySnapshot(
  date: string,
  entries: Array<{
    id?: string;
    projectId?: string;
    taskId?: string;
    hours: number;
  }>
): SnapshotBuildResult {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, reason: 'invalid_date', invalidEntryIndexes: [] };
  }

  const built: SnapshotEntry[] = [];
  const invalidEntryIndexes: number[] = [];
  let failReason: SnapshotBuildFailureReason | null = null;
  const seen = new Set<string>();

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    const projectId = typeof e.projectId === 'string' ? e.projectId.trim() : '';
    const taskId = typeof e.taskId === 'string' ? e.taskId.trim() : '';
    const hours = e.hours;

    if (!projectId) {
      invalidEntryIndexes.push(i);
      failReason = failReason ?? 'missing_project_id';
      continue;
    }
    if (!taskId) {
      invalidEntryIndexes.push(i);
      failReason = failReason ?? 'missing_task_id';
      continue;
    }
    if (!Number.isFinite(hours) || Number.isNaN(hours) || hours < 0 || hours > 24) {
      invalidEntryIndexes.push(i);
      failReason = failReason ?? 'invalid_hours';
      continue;
    }

    const id = typeof e.id === 'string' && e.id.trim() ? e.id.trim() : undefined;
    const dupKey = `${projectId}|${taskId}`;
    if (seen.has(dupKey)) {
      invalidEntryIndexes.push(i);
      failReason = failReason ?? 'duplicate_entries';
      continue;
    }
    seen.add(dupKey);

    built.push({ id, projectId, taskId, hours });
  }

  if (failReason) {
    return { ok: false, reason: failReason, invalidEntryIndexes };
  }

  return {
    ok: true,
    snapshot: normalizeDaySnapshot({ date, entries: built }),
  };
}

/**
 * @deprecated Prefer buildDaySnapshot — silent filtering was removed.
 * Throws if the day cannot be represented losslessly.
 */
export function daySnapshotFromDailyEntries(
  date: string,
  entries: Array<{
    id?: string;
    projectId?: string;
    taskId?: string;
    hours: number;
  }>
): DaySnapshot {
  const result = buildDaySnapshot(date, entries);
  if (!result.ok) {
    throw new IncompleteDaySnapshotError(result.reason, result.invalidEntryIndexes);
  }
  return result.snapshot;
}

export class IncompleteDaySnapshotError extends Error {
  readonly reason: SnapshotBuildFailureReason;
  readonly invalidEntryIndexes: number[];

  constructor(
    reason: SnapshotBuildFailureReason,
    invalidEntryIndexes: number[]
  ) {
    super(`Incomplete day snapshot: ${reason}`);
    this.name = 'IncompleteDaySnapshotError';
    this.reason = reason;
    this.invalidEntryIndexes = invalidEntryIndexes;
  }
}

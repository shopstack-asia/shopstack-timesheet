import { createHash } from 'crypto';
import type { DaySnapshot, SnapshotEntry } from '@/lib/timesheet/write/pending-types';

function sortKey(e: SnapshotEntry): string {
  return `${e.projectId}|${e.taskId}|${e.id || ''}`;
}

/** Normalize day snapshot for hashing (sorted, no display labels). */
export function normalizeDaySnapshot(snapshot: DaySnapshot): DaySnapshot {
  const entries = [...snapshot.entries]
    .map((e) => ({
      id: e.id?.trim() || undefined,
      projectId: e.projectId.trim(),
      taskId: e.taskId.trim(),
      hours: Number(e.hours),
    }))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return { date: snapshot.date, entries };
}

export function hashDaySnapshot(snapshot: DaySnapshot): string {
  const normalized = normalizeDaySnapshot(snapshot);
  const payload = JSON.stringify(normalized);
  return createHash('sha256').update(payload).digest('hex');
}

export function snapshotsEqual(a: DaySnapshot, b: DaySnapshot): boolean {
  return hashDaySnapshot(a) === hashDaySnapshot(b);
}

export function daySnapshotFromDailyEntries(
  date: string,
  entries: Array<{
    id?: string;
    projectId?: string;
    taskId?: string;
    hours: number;
  }>
): DaySnapshot {
  return normalizeDaySnapshot({
    date,
    entries: entries
      .filter((e) => e.projectId && e.taskId)
      .map((e) => ({
        id: e.id,
        projectId: e.projectId!,
        taskId: e.taskId!,
        hours: e.hours,
      })),
  });
}

import { DayEntry, dayKey } from '@/lib/timesheet-agent/merge';

export function roundHours(hours: number): number {
  return Math.round(hours * 10000) / 10000;
}

export function normalizeDayEntries(
  entries: Array<{ projectId: string; taskId: string; hours: number }>
): DayEntry[] {
  const map = new Map<string, DayEntry>();
  for (const e of entries) {
    map.set(dayKey(e.projectId, e.taskId), {
      projectId: e.projectId,
      taskId: e.taskId,
      hours: roundHours(e.hours),
    });
  }
  return Array.from(map.values()).sort((a, b) =>
    dayKey(a.projectId, a.taskId).localeCompare(dayKey(b.projectId, b.taskId))
  );
}

export function dayFingerprint(
  entries: Array<{ projectId: string; taskId: string; hours: number }>
): string {
  return normalizeDayEntries(entries)
    .map((e) => `${e.projectId}|${e.taskId}|${e.hours}`)
    .join(';');
}

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      expectedTotal: number;
      actualTotal: number;
      expected: DayEntry[];
      actual: DayEntry[];
      reason: string;
    };

export function verifyDayMatchesExpected(
  expected: Array<{ projectId: string; taskId: string; hours: number }>,
  actual: Array<{ projectId: string; taskId: string; hours: number }>
): VerifyResult {
  const exp = normalizeDayEntries(expected);
  const act = normalizeDayEntries(actual);
  const expectedTotal = exp.reduce((s, e) => s + e.hours, 0);
  const actualTotal = act.reduce((s, e) => s + e.hours, 0);

  if (exp.length !== act.length) {
    return {
      ok: false,
      expectedTotal,
      actualTotal,
      expected: exp,
      actual: act,
      reason: `Entry count mismatch (expected ${exp.length}, actual ${act.length})`,
    };
  }

  for (let i = 0; i < exp.length; i++) {
    if (
      exp[i].projectId !== act[i].projectId ||
      exp[i].taskId !== act[i].taskId ||
      Math.abs(exp[i].hours - act[i].hours) > 0.0001
    ) {
      return {
        ok: false,
        expectedTotal,
        actualTotal,
        expected: exp,
        actual: act,
        reason: `Mismatch at ${exp[i].projectId}|${exp[i].taskId}`,
      };
    }
  }

  return { ok: true };
}

import { describe, expect, it } from 'vitest';
import {
  dayKey,
  entriesToDaySet,
  mergeAdd,
  mergeDelete,
  mergeUpdate,
} from '@/lib/timesheet-agent/merge';
import { dayFingerprint } from '@/lib/timesheet-agent/verify';

describe('correction targeting and stale snapshot', () => {
  it('correction targets non-last entry by key', () => {
    const entries = [
      { projectId: 'A', taskId: '1', hours: 4 },
      { projectId: 'B', taskId: '1', hours: 2 },
      { projectId: 'C', taskId: '1', hours: 1 },
    ];
    const targetKey = dayKey('A', '1');
    const updated = entries.map((e) =>
      dayKey(e.projectId, e.taskId) === targetKey ? { ...e, hours: 6 } : e
    );
    expect(updated[0].hours).toBe(6);
    expect(updated[2].hours).toBe(1);
  });

  it('stale overwrite prevention: re-merge add C when D appeared', () => {
    const base = [
      { projectId: 'A', taskId: '1', hours: 1 },
      { projectId: 'B', taskId: '1', hours: 1 },
    ];
    const pendingAdd = { projectId: 'C', taskId: '1', hours: 1 };
    const baseFp = dayFingerprint(base);

    // concurrent change adds D
    const latest = [...base, { projectId: 'D', taskId: '1', hours: 1 }];
    expect(dayFingerprint(latest)).not.toBe(baseFp);

    let daySet = entriesToDaySet(latest);
    const r = mergeAdd(daySet, pendingAdd, 'replace');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.daySet.has('A|1')).toBe(true);
      expect(r.daySet.has('B|1')).toBe(true);
      expect(r.daySet.has('C|1')).toBe(true);
      expect(r.daySet.has('D|1')).toBe(true);
      // Must NOT be only A+B+C (which would drop D)
      expect(r.daySet.size).toBe(4);
    }
  });

  it('re-merge update/delete preserve siblings', () => {
    const latest = entriesToDaySet([
      { projectId: 'A', taskId: '1', hours: 1 },
      { projectId: 'B', taskId: '1', hours: 1 },
      { projectId: 'D', taskId: '1', hours: 1 },
    ]);
    const upd = mergeUpdate(latest, 'A', '1', 9);
    expect(upd.ok).toBe(true);
    if (upd.ok) {
      expect(upd.daySet.get('A|1')?.hours).toBe(9);
      expect(upd.daySet.has('D|1')).toBe(true);
    }
    const del = mergeDelete(upd.ok ? upd.daySet : latest, 'B', '1');
    expect(del.ok).toBe(true);
    if (del.ok) {
      expect(del.daySet.has('B|1')).toBe(false);
      expect(del.daySet.has('D|1')).toBe(true);
    }
  });
});

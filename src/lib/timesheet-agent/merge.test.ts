import { describe, expect, it } from 'vitest';
import {
  daySetToEntries,
  entriesToDaySet,
  mergeAdd,
  mergeClear,
  mergeDelete,
  mergeUpdate,
} from '@/lib/timesheet-agent/merge';

describe('merge', () => {
  it('adds to empty day', () => {
    const r = mergeAdd(new Map(), { projectId: '1', taskId: '2', hours: 4 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(daySetToEntries(r.daySet)).toEqual([
        { projectId: '1', taskId: '2', hours: 4 },
      ]);
    }
  });

  it('preserves A/B when adding C', () => {
    let set = entriesToDaySet([
      { projectId: 'A', taskId: '1', hours: 2 },
      { projectId: 'B', taskId: '1', hours: 3 },
    ]);
    const r = mergeAdd(set, { projectId: 'C', taskId: '1', hours: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.daySet.size).toBe(3);
  });

  it('updates A hours', () => {
    const set = entriesToDaySet([
      { projectId: 'A', taskId: '1', hours: 2 },
      { projectId: 'B', taskId: '1', hours: 3 },
    ]);
    const r = mergeUpdate(set, 'A', '1', 6);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.daySet.get('A|1')?.hours).toBe(6);
  });

  it('deletes A keeping B', () => {
    const set = entriesToDaySet([
      { projectId: 'A', taskId: '1', hours: 2 },
      { projectId: 'B', taskId: '1', hours: 3 },
    ]);
    const r = mergeDelete(set, 'A', '1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.becameEmpty).toBe(false);
      expect(r.daySet.size).toBe(1);
    }
  });

  it('delete final entry becomes empty', () => {
    const set = entriesToDaySet([{ projectId: 'A', taskId: '1', hours: 2 }]);
    const r = mergeDelete(set, 'A', '1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.becameEmpty).toBe(true);
  });

  it('duplicate project+task asks by default', () => {
    const set = entriesToDaySet([{ projectId: 'A', taskId: '1', hours: 2 }]);
    const r = mergeAdd(set, { projectId: 'A', taskId: '1', hours: 3 }, 'ask');
    expect(r.ok).toBe(true);
    if (r.ok && r.duplicate) {
      expect(r.needsPolicy).toBe(true);
      expect(r.existingHours).toBe(2);
    }
  });

  it('duplicate sum policy', () => {
    const set = entriesToDaySet([{ projectId: 'A', taskId: '1', hours: 2 }]);
    const r = mergeAdd(set, { projectId: 'A', taskId: '1', hours: 3 }, 'sum');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.daySet.get('A|1')?.hours).toBe(5);
  });

  it('clear day', () => {
    expect(mergeClear().size).toBe(0);
  });

  it('rejects hours <= 0', () => {
    const r = mergeAdd(new Map(), { projectId: 'A', taskId: '1', hours: 0 });
    expect(r.ok).toBe(false);
  });
});

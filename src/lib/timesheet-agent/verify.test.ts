import { describe, expect, it } from 'vitest';
import {
  dayFingerprint,
  normalizeDayEntries,
  verifyDayMatchesExpected,
} from '@/lib/timesheet-agent/verify';

describe('post-save verification', () => {
  it('exact match', () => {
    const entries = [
      { projectId: 'B', taskId: '1', hours: 2 },
      { projectId: 'A', taskId: '1', hours: 4 },
    ];
    expect(verifyDayMatchesExpected(entries, [...entries].reverse()).ok).toBe(true);
  });

  it('missing row', () => {
    const r = verifyDayMatchesExpected(
      [
        { projectId: 'A', taskId: '1', hours: 4 },
        { projectId: 'B', taskId: '1', hours: 2 },
      ],
      [{ projectId: 'A', taskId: '1', hours: 4 }]
    );
    expect(r.ok).toBe(false);
  });

  it('unexpected additional row', () => {
    const r = verifyDayMatchesExpected(
      [{ projectId: 'A', taskId: '1', hours: 4 }],
      [
        { projectId: 'A', taskId: '1', hours: 4 },
        { projectId: 'B', taskId: '1', hours: 1 },
      ]
    );
    expect(r.ok).toBe(false);
  });

  it('incorrect hours', () => {
    const r = verifyDayMatchesExpected(
      [{ projectId: 'A', taskId: '1', hours: 4 }],
      [{ projectId: 'A', taskId: '1', hours: 6 }]
    );
    expect(r.ok).toBe(false);
  });

  it('empty-day verification', () => {
    expect(verifyDayMatchesExpected([], []).ok).toBe(true);
    expect(verifyDayMatchesExpected([], [{ projectId: 'A', taskId: '1', hours: 1 }]).ok).toBe(
      false
    );
  });

  it('fingerprint stable regardless of order', () => {
    const a = dayFingerprint([
      { projectId: '2', taskId: '1', hours: 1 },
      { projectId: '1', taskId: '1', hours: 2 },
    ]);
    const b = dayFingerprint([
      { projectId: '1', taskId: '1', hours: 2 },
      { projectId: '2', taskId: '1', hours: 1 },
    ]);
    expect(a).toBe(b);
    expect(normalizeDayEntries([{ projectId: '1', taskId: '1', hours: 7.5 }])[0].hours).toBe(7.5);
  });
});

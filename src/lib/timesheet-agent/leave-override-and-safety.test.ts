import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LeaveDayEntry } from '@/types';
import { evaluateWriteGuards } from '@/lib/timesheet-agent/guardrails';
import { entriesToDaySet } from '@/lib/timesheet-agent/merge';
import { textSatisfiesRequiredKeyword } from '@/lib/timesheet-agent/confirm-keywords';

/**
 * Leave OVERRIDE flow (unit-level):
 * full leave → block with OVERRIDE → after leaveOverride → guards pass → YES still required separately
 */
describe('full leave OVERRIDE flow', () => {
  const leave: LeaveDayEntry[] = [
    {
      date: '2026-07-14',
      type: 'FULL',
      dayType: 'FULL_DAY',
      leaveType: 'Annual',
      reason: '',
      status: 'Approved',
    },
  ];
  const daySet = entriesToDaySet([{ projectId: '1', taskId: '1', hours: 4 }]);

  it('blocks without override', () => {
    const r = evaluateWriteGuards({
      date: '2026-07-14',
      daySet,
      leave,
      holidays: [],
      isFuture: false,
      leaveOverride: false,
    });
    expect(r.ok).toBe(false);
    expect(r.requireKeyword).toBe('OVERRIDE');
  });

  it('allows after override flag then still needs YES keyword for write', () => {
    const r = evaluateWriteGuards({
      date: '2026-07-14',
      daySet,
      leave,
      holidays: [],
      isFuture: false,
      leaveOverride: true,
    });
    expect(r.ok).toBe(true);
    expect(textSatisfiesRequiredKeyword('OVERRIDE', 'YES')).toBe(false);
    expect(textSatisfiesRequiredKeyword('YES', 'YES')).toBe(true);
  });

  it('OVERRIDE alone must not satisfy YES write confirmation', () => {
    expect(textSatisfiesRequiredKeyword('OVERRIDE', undefined)).toBe(false);
    expect(textSatisfiesRequiredKeyword('OVERRIDE', 'YES')).toBe(false);
  });
});

describe('empty-day clear', () => {
  it('does not require CLEAR when day has no entries', async () => {
    const { evaluateClearGuards } = await import('@/lib/timesheet-agent/guardrails');
    const r = evaluateClearGuards(false);
    expect(r.ok).toBe(true);
    expect(r.requireKeyword).toBeUndefined();
    expect(r.warnings.some((w) => /already empty/i.test(w))).toBe(true);
  });
});

describe('submit service rejects custom project when disabled', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws on unknown project when allowCustomProject false', async () => {
    vi.doMock('@/lib/google-sheets', () => ({
      getCachedProjects: async () => [
        {
          ProjectID: '1',
          ProjectClient: 'A',
          ProjectName: 'P',
          ProjectCode: 'P',
        },
      ],
      getCachedTasks: async () => [{ TaskID: '1', Task: 'Dev' }],
      getGoogleSheetsService: () => ({}),
    }));
    vi.doMock('@/lib/sheets-write-lock', () => ({
      withTimeLogWriteLock: async (fn: () => Promise<unknown>) => fn(),
      SheetsWriteLockError: class extends Error {
        code = 'LOCK_TIMEOUT';
      },
    }));

    const { submitDayTimesheetForStaff } = await import(
      '@/lib/timesheet/timesheet-service'
    );
    await expect(
      submitDayTimesheetForStaff(
        {
          staff: {
            EmployeeID: 'S1',
            FirstName: 'A',
            LastName: 'B',
            Nickname: 'A',
            Email: 'a@shopstack.asia',
            Position: 'Eng',
          },
          source: 'slack',
        },
        '2026-07-14',
        [{ projectId: 'UNKNOWN', taskId: '1', hours: 2 }],
        { allowCustomProject: false }
      )
    ).rejects.toThrow(/Unknown project ID/);
  });
});

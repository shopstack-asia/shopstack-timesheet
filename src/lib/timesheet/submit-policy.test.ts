import { describe, expect, it, vi } from 'vitest';
import {
  assertSubmitBusinessRules,
  SubmitPolicyDependencyError,
  SubmitPolicyError,
} from '@/lib/timesheet/submit-policy';
import { entriesToDaySet } from '@/lib/timesheet-agent/merge';
import type { LeaveDayEntry, Holiday } from '@/types';

const ctx = {
  staff: {
    EmployeeID: 'S1',
    FirstName: 'A',
    LastName: 'B',
    Nickname: 'A',
    Email: 'a@shopstack.asia',
    Position: 'Eng',
  },
  source: 'session' as const,
};

describe('submit-policy fail closed', () => {
  it('empty-entry clear-day skips policy loads', async () => {
    const loadLeave = vi.fn();
    await assertSubmitBusinessRules(ctx, '2026-07-14', [], {}, { loadLeave });
    expect(loadLeave).not.toHaveBeenCalled();
  });

  it('leave service failure → dependency error', async () => {
    await expect(
      assertSubmitBusinessRules(
        ctx,
        '2026-07-14',
        [{ projectId: '1', taskId: '1', hours: 2 }],
        {},
        {
          loadLeave: async () => {
            throw new Error('zoho down');
          },
          loadHolidays: async () => [],
        }
      )
    ).rejects.toBeInstanceOf(SubmitPolicyDependencyError);
  });

  it('holiday service failure → dependency error', async () => {
    await expect(
      assertSubmitBusinessRules(
        ctx,
        '2026-07-14',
        [{ projectId: '1', taskId: '1', hours: 2 }],
        {},
        {
          loadLeave: async () => [],
          loadHolidays: async () => {
            throw new Error('redis down');
          },
        }
      )
    ).rejects.toBeInstanceOf(SubmitPolicyDependencyError);
  });

  it('normal successful validation', async () => {
    await assertSubmitBusinessRules(
      ctx,
      '2026-07-14',
      [{ projectId: '1', taskId: '1', hours: 2 }],
      {},
      {
        loadLeave: async () => [],
        loadHolidays: async () => [],
      }
    );
  });

  it('policy rejection with leave code', async () => {
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
    try {
      await assertSubmitBusinessRules(
        ctx,
        '2026-07-14',
        [{ projectId: '1', taskId: '1', hours: 2 }],
        {},
        {
          loadLeave: async () => leave,
          loadHolidays: async () => [],
        }
      );
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SubmitPolicyError);
      expect((e as SubmitPolicyError).policyCode).toBe('LEAVE_OVERRIDE_REQUIRED');
    }
  });

  it('holiday rejection code', async () => {
    const holidays: Holiday[] = [
      { id: 'h1', date: '2026-07-14', name: 'Test Day', is_holiday: true },
    ];
    try {
      await assertSubmitBusinessRules(
        ctx,
        '2026-07-14',
        [{ projectId: '1', taskId: '1', hours: 2 }],
        {},
        {
          loadLeave: async () => [],
          loadHolidays: async () => holidays,
        }
      );
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SubmitPolicyError);
      expect((e as SubmitPolicyError).policyCode).toBe('HOLIDAY_ACK_REQUIRED');
    }
  });
});

describe('day set helper sanity', () => {
  it('builds set', () => {
    expect(entriesToDaySet([{ projectId: '1', taskId: '1', hours: 1 }]).size).toBe(1);
  });
});

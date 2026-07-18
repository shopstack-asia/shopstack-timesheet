import { describe, expect, it, vi } from 'vitest';
import {
  submitDayWithExplicitPolicyAcks,
  submitWeekDaysSequentially,
} from '@/lib/submit-week-days';
import { dayFingerprint } from '@/lib/timesheet-agent/verify';
import { ackFlagsFromPresentedCodes } from '@/lib/timesheet-agent/guardrails';

describe('submitWeekDaysSequentially', () => {
  it('posts days with entries in order', async () => {
    const order: string[] = [];
    const postDay = vi.fn(async (day: { date: string }) => {
      order.push(day.date);
      return { success: true };
    });

    const results = await submitWeekDaysSequentially(
      [
        {
          date: '2026-07-13',
          entries: [{ projectId: 'p1', taskId: 't1', hours: 1 }],
        },
        {
          date: '2026-07-14',
          entries: [{ projectId: 'p1', taskId: 't1', hours: 2 }],
        },
      ],
      postDay
    );

    expect(order).toEqual(['2026-07-13', '2026-07-14']);
    expect(results).toEqual([
      { date: '2026-07-13', success: true },
      { date: '2026-07-14', success: true },
    ]);
    expect(postDay).toHaveBeenCalledTimes(2);
  });

  it('skips days with no entries', async () => {
    const postDay = vi.fn(async () => ({ success: true }));

    const results = await submitWeekDaysSequentially(
      [
        { date: '2026-07-13', entries: [] },
        {
          date: '2026-07-14',
          entries: [{ projectId: 'p1', taskId: 't1', hours: 1 }],
        },
      ],
      postDay
    );

    expect(postDay).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ date: '2026-07-14', success: true }]);
  });

  it('continues after a mid-week failure and aggregates results', async () => {
    const postDay = vi.fn(async (day: { date: string }) => {
      if (day.date === '2026-07-14') {
        return { success: false, error: 'boom' };
      }
      return { success: true };
    });

    const results = await submitWeekDaysSequentially(
      [
        {
          date: '2026-07-13',
          entries: [{ projectId: 'p1', taskId: 't1', hours: 1 }],
        },
        {
          date: '2026-07-14',
          entries: [{ projectId: 'p1', taskId: 't1', hours: 1 }],
        },
        {
          date: '2026-07-15',
          entries: [{ projectId: 'p1', taskId: 't1', hours: 1 }],
        },
      ],
      postDay
    );

    expect(postDay).toHaveBeenCalledTimes(3);
    expect(results).toEqual([
      { date: '2026-07-13', success: true },
      { date: '2026-07-14', success: false, error: 'boom' },
      { date: '2026-07-15', success: true },
    ]);
  });
});

describe('web explicit policy confirmation', () => {
  const day = {
    date: '2026-07-14',
    entries: [{ projectId: '1', taskId: '1', hours: 2 }],
  };

  it('normal submission without warnings', async () => {
    const postDay = vi.fn().mockResolvedValue({ success: true });
    const confirm = vi.fn();
    const r = await submitDayWithExplicitPolicyAcks(day, postDay, confirm);
    expect(r.success).toBe(true);
    expect(postDay).toHaveBeenCalledTimes(1);
    expect(postDay.mock.calls[0][0].leaveOverride).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('each warning separately then succeeds', async () => {
    const postDay = vi
      .fn()
      .mockResolvedValueOnce({
        success: false,
        error: 'leave',
        policyCode: 'LEAVE_OVERRIDE_REQUIRED',
      })
      .mockResolvedValueOnce({ success: true });
    const confirm = vi.fn().mockResolvedValue(true);
    const r = await submitDayWithExplicitPolicyAcks(day, postDay, confirm);
    expect(r.success).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      '2026-07-14',
      'LEAVE_OVERRIDE_REQUIRED',
      'leave'
    );
    expect(postDay.mock.calls[1][0].leaveOverride).toBe(true);
  });

  it('multiple warnings sequential', async () => {
    const postDay = vi
      .fn()
      .mockResolvedValueOnce({
        success: false,
        error: 'over24',
        policyCode: 'OVER_24_ACK_REQUIRED',
      })
      .mockResolvedValueOnce({
        success: false,
        error: 'holiday',
        policyCode: 'HOLIDAY_ACK_REQUIRED',
      })
      .mockResolvedValueOnce({ success: true });
    const confirm = vi.fn().mockResolvedValue(true);
    const r = await submitDayWithExplicitPolicyAcks(day, postDay, confirm);
    expect(r.success).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(postDay.mock.calls[2][0].over24Acknowledged).toBe(true);
    expect(postDay.mock.calls[2][0].holidayAcknowledged).toBe(true);
  });

  it('user cancel leaves day unchanged', async () => {
    const postDay = vi.fn().mockResolvedValue({
      success: false,
      error: 'future',
      policyCode: 'FUTURE_ACK_REQUIRED',
    });
    const confirm = vi.fn().mockResolvedValue(false);
    const r = await submitDayWithExplicitPolicyAcks(day, postDay, confirm);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Cancelled/i);
    expect(postDay).toHaveBeenCalledTimes(1);
  });

  it('no automatic acknowledgments on sequential week submit', async () => {
    const postDay = vi.fn().mockResolvedValue({ success: true });
    await submitWeekDaysSequentially([day], postDay);
    expect(postDay.mock.calls[0][0].leaveOverride).toBeUndefined();
    expect(postDay.mock.calls[0][0].holidayAcknowledged).toBeUndefined();
  });
});

describe('slack pending acknowledgment binding', () => {
  it('YES only acknowledges presented codes', () => {
    const flags = ackFlagsFromPresentedCodes(['HOLIDAY_ACK_REQUIRED'], {
      leaveOverride: true,
    });
    expect(flags.leaveOverride).toBe(true);
    expect(flags.holidayAcknowledged).toBe(true);
    expect(flags.futureAcknowledged).toBeUndefined();
    expect(flags.over24Acknowledged).toBeUndefined();
  });

  it('confirmation without prior warning yields no holiday/future/over24 acks', () => {
    const flags = ackFlagsFromPresentedCodes([]);
    expect(flags.holidayAcknowledged).toBeUndefined();
    expect(flags.futureAcknowledged).toBeUndefined();
    expect(flags.over24Acknowledged).toBeUndefined();
  });

  it('changed entries change fingerprint', () => {
    const a = dayFingerprint([{ projectId: '1', taskId: '1', hours: 2 }]);
    const b = dayFingerprint([{ projectId: '1', taskId: '1', hours: 3 }]);
    expect(a).not.toBe(b);
  });
});

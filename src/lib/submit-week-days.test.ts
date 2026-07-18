import { describe, it, expect, vi } from 'vitest';
import { submitWeekDaysSequentially } from '@/lib/submit-week-days';

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
      { date: '2026-07-13', success: true, error: undefined },
      { date: '2026-07-14', success: true, error: undefined },
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
    expect(results).toEqual([
      { date: '2026-07-14', success: true, error: undefined },
    ]);
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
      { date: '2026-07-13', success: true, error: undefined },
      { date: '2026-07-14', success: false, error: 'boom' },
      { date: '2026-07-15', success: true, error: undefined },
    ]);
  });
});

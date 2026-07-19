import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextManager } from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import { createIdentityResolver } from '@/lib/conversation/context/identity-resolver';
import { createToolContext } from '@/lib/tools/tool-context';
import { createDefaultToolRegistry } from '@/lib/tools';
import {
  createGetWeekTimesheetTool,
  parseWeekTimesheet,
} from '@/lib/tools/business/timesheet/get-week-timesheet';
import { bangkokCurrentWeek } from '@/lib/tools/business/timesheet/bangkok-dates';
import type { TimesheetRange } from '@/lib/tools/business/types';

describe('parseWeekTimesheet (compat)', () => {
  it('still parses legacy week shape', () => {
    const week = parseWeekTimesheet({
      weekStart: '2026-07-13',
      days: [{ date: '2026-07-13', totalHours: 8 }],
      weeklyTotal: 8,
      submitted: true,
    });
    expect(week.weeklyTotal).toBe(8);
  });
});

describe('get_week_timesheet deprecated wrapper', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('calls canonical range for Bangkok current week', async () => {
    const { startDate, endDate } = bangkokCurrentWeek();
    let called: { start: string; end: string } | null = null;
    const tool = createGetWeekTimesheetTool({
      readTimesheetRange: async (_id, start, end) => {
        called = { start, end };
        const range: TimesheetRange = {
          startDate: start,
          endDate: end,
          days: [
            {
              date: start,
              entries: [{ hours: 8 }],
              totalHours: 8,
              expectedHours: 8,
              remainingHours: 0,
              submitted: true,
            },
          ],
          totalHours: 8,
          expectedHours: 8,
          remainingHours: 0,
          submittedDays: 1,
          unsubmittedDays: 0,
        };
        return range;
      },
      contextManager: createContextManager({
        store: createContextStore(),
        identityResolver: createIdentityResolver({
          lookup: async () => ({
            ok: true,
            auth: {
              staff: {
                EmployeeID: 'S1',
                Email: 'ada@shopstack.asia',
              },
            },
          }),
        }),
      }),
    });
    const result = await tool.execute(
      {},
      createToolContext({ userId: 'U1', conversationId: 'conv-week' })
    );
    expect(result.success).toBe(true);
    expect(called).toEqual({ start: startDate, end: endDate });
  });

  it('not registered in AI default registry', () => {
    expect(createDefaultToolRegistry().exists('get_week_timesheet')).toBe(
      false
    );
  });
});

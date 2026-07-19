import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextManager } from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import { createIdentityResolver } from '@/lib/conversation/context/identity-resolver';
import { createToolContext } from '@/lib/tools/tool-context';
import { createDefaultToolRegistry } from '@/lib/tools';
import {
  createGetTodayTimesheetTool,
  parseTodayTimesheet,
} from '@/lib/tools/business/timesheet/get-today-timesheet';
import { bangkokToday } from '@/lib/tools/business/timesheet/bangkok-dates';
import type { DailyTimesheet } from '@/lib/tools/business/types';

describe('parseTodayTimesheet (compat)', () => {
  it('delegates to daily parser', () => {
    const today = parseTodayTimesheet({
      date: '2026-07-18',
      entries: [{ hours: 2 }, { hours: 1 }],
    });
    expect(today.totalHours).toBe(3);
  });
});

describe('get_today_timesheet deprecated wrapper', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('calls canonical daily read for Bangkok today', async () => {
    const today = bangkokToday();
    let calledDate = '';
    const tool = createGetTodayTimesheetTool({
      readDailyTimesheet: async (_id, date) => {
        calledDate = date;
        const day: DailyTimesheet = {
          date,
          entries: [],
          totalHours: 0,
          expectedHours: 8,
          remainingHours: 8,
          submitted: false,
        };
        return day;
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
      createToolContext({ userId: 'U1', conversationId: 'conv-today' })
    );
    expect(result.success).toBe(true);
    expect(calledDate).toBe(today);
  });

  it('not registered in AI default registry', () => {
    expect(createDefaultToolRegistry().exists('get_today_timesheet')).toBe(
      false
    );
  });
});

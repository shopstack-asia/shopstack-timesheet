import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessApiClient } from '@/lib/business/client';
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
import { TIMESHEET_API_PATHS } from '@/lib/tools/business/types';

function mockClient(
  impl: (
    path: string,
    options?: Parameters<BusinessApiClient['get']>[1]
  ) => Promise<{
    success: true;
    data: unknown;
    status: number;
    requestId: string;
  }>
): BusinessApiClient {
  return {
    getConfig: () => ({
      baseUrl: 'https://timesheet-api.test',
      timeoutMs: 5000,
      apiKey: 'k',
      maxRetries: 0,
      logging: false,
    }),
    request: async () => {
      throw new Error('not used');
    },
    get: (async (path, options) =>
      impl(path, options)) as BusinessApiClient['get'],
    post: async () => {
      throw new Error('not used');
    },
    put: async () => {
      throw new Error('not used');
    },
    patch: async () => {
      throw new Error('not used');
    },
    delete: async () => {
      throw new Error('not used');
    },
  };
}

function makeDeps(client: BusinessApiClient) {
  return {
    client,
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
      businessClient: client,
    }),
  };
}

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

  it('rejects malformed', () => {
    expect(() => parseWeekTimesheet({ weekStart: 'x' })).toThrow(/Malformed/);
  });
});

describe('get_week_timesheet deprecated wrapper', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('calls shared /v1/timesheets range for Bangkok current week', async () => {
    const { startDate, endDate } = bangkokCurrentWeek();
    const tool = createGetWeekTimesheetTool(
      makeDeps(
        mockClient(async (path, options) => {
          expect(path).toBe(
            `${TIMESHEET_API_PATHS.timesheets}?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
          );
          expect(options?.headers?.['X-Employee-Id']).toBe('S1');
          return {
            success: true,
            data: {
              days: [
                {
                  date: startDate,
                  entries: [{ hours: 8 }],
                  totalHours: 8,
                  expectedHours: 8,
                  remainingHours: 0,
                  submitted: true,
                },
              ],
            },
            status: 200,
            requestId: 'r1',
          };
        })
      )
    );
    const result = await tool.execute(
      {},
      createToolContext({ userId: 'U1', conversationId: 'conv-week' })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({
        weekStart: startDate,
        weekEnd: endDate,
        weeklyTotal: 8,
      });
    }
  });

  it('not registered in AI default registry', () => {
    expect(createDefaultToolRegistry().exists('get_week_timesheet')).toBe(
      false
    );
  });
});

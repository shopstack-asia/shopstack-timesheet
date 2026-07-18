import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessApiClient } from '@/lib/business/client';
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

describe('parseTodayTimesheet (compat)', () => {
  it('delegates to daily parser', () => {
    const today = parseTodayTimesheet({
      date: '2026-07-18',
      entries: [{ hours: 2 }, { hours: 1 }],
    });
    expect(today.totalHours).toBe(3);
    expect(today.remainingHours).toBe(5);
  });
});

describe('get_today_timesheet deprecated wrapper', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('calls shared /v1/timesheets?date=Bangkok-today', async () => {
    const today = bangkokToday();
    const tool = createGetTodayTimesheetTool(
      makeDeps(
        mockClient(async (path, options) => {
          expect(path).toBe(
            `${TIMESHEET_API_PATHS.timesheets}?date=${encodeURIComponent(today)}`
          );
          expect(options?.headers?.['X-Employee-Id']).toBe('S1');
          return {
            success: true,
            data: {
              date: today,
              entries: [],
              totalHours: 0,
              expectedHours: 8,
              remainingHours: 8,
              submitted: false,
            },
            status: 200,
            requestId: 'r1',
          };
        })
      )
    );
    const result = await tool.execute(
      {},
      createToolContext({ userId: 'U1', conversationId: 'conv-today' })
    );
    expect(result.success).toBe(true);
  });

  it('not registered in AI default registry', () => {
    expect(createDefaultToolRegistry().exists('get_today_timesheet')).toBe(
      false
    );
  });
});

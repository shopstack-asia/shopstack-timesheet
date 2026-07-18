import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthenticationError,
  TimeoutError,
  UnexpectedApiError,
} from '@/lib/business/errors';
import type { BusinessApiClient } from '@/lib/business/client';
import { createContextManager } from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import { createIdentityResolver } from '@/lib/conversation/context/identity-resolver';
import { createToolContext } from '@/lib/tools/tool-context';
import { createDefaultToolRegistry } from '@/lib/tools';
import {
  createGetTimesheetRangeTool,
  parseTimesheetRange,
} from '@/lib/tools/business/timesheet/get-timesheet-range';
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

const rangePayload = {
  startDate: '2026-07-13',
  endDate: '2026-07-19',
  days: [
    {
      date: '2026-07-13',
      entries: [{ hours: 8 }],
      totalHours: 8,
      expectedHours: 8,
      remainingHours: 0,
      submitted: true,
    },
    {
      date: '2026-07-14',
      entries: [{ hours: 4 }],
      totalHours: 4,
      expectedHours: 8,
      remainingHours: 4,
      submitted: false,
    },
  ],
};

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

function toolCtx(signal?: AbortSignal) {
  return createToolContext({
    userId: 'U1',
    conversationId: 'conv-range',
    signal,
  });
}

describe('parseTimesheetRange', () => {
  it('aggregates totals and submitted counts', () => {
    const range = parseTimesheetRange(
      rangePayload,
      '2026-07-13',
      '2026-07-19'
    );
    expect(range.totalHours).toBe(12);
    expect(range.submittedDays).toBe(1);
    expect(range.unsubmittedDays).toBe(1);
    expect(range.days).toHaveLength(2);
  });

  it('empty days', () => {
    const range = parseTimesheetRange(
      { days: [] },
      '2026-07-13',
      '2026-07-13'
    );
    expect(range.days).toEqual([]);
    expect(range.totalHours).toBe(0);
  });

  it('rejects malformed', () => {
    expect(() =>
      parseTimesheetRange({ foo: 1 }, '2026-07-13', '2026-07-14')
    ).toThrow(/Malformed/);
  });
});

describe('get_timesheet_range tool', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('valid range with inclusive query and identity', async () => {
    const tool = createGetTimesheetRangeTool(
      makeDeps(
        mockClient(async (path, options) => {
          expect(path).toBe(
            `${TIMESHEET_API_PATHS.timesheets}?startDate=2026-07-13&endDate=2026-07-19`
          );
          expect(options?.headers?.['X-Employee-Id']).toBe('S1');
          return {
            success: true,
            data: rangePayload,
            status: 200,
            requestId: 'r1',
          };
        })
      )
    );
    const result = await tool.execute(
      { startDate: '2026-07-13', endDate: '2026-07-19' },
      toolCtx()
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({
        totalHours: 12,
        submittedDays: 1,
        unsubmittedDays: 1,
        employeeId: 'S1',
      });
    }
  });

  it('same-day range', async () => {
    const tool = createGetTimesheetRangeTool(
      makeDeps(
        mockClient(async (path) => {
          expect(path).toContain('startDate=2026-07-17');
          expect(path).toContain('endDate=2026-07-17');
          return {
            success: true,
            data: {
              days: [
                {
                  date: '2026-07-17',
                  entries: [],
                  totalHours: 0,
                  expectedHours: 8,
                  remainingHours: 8,
                  submitted: false,
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
      { startDate: '2026-07-17', endDate: '2026-07-17' },
      toolCtx()
    );
    expect(result.success).toBe(true);
  });

  it('start date after end date', async () => {
    const tool = createGetTimesheetRangeTool(
      makeDeps(mockClient(async () => {
        throw new Error('should not call');
      }))
    );
    const result = await tool.execute(
      { startDate: '2026-07-19', endDate: '2026-07-13' },
      toolCtx()
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toMatch(/startDate/);
    }
  });

  it('range over 31 days', async () => {
    const tool = createGetTimesheetRangeTool(
      makeDeps(mockClient(async () => {
        throw new Error('should not call');
      }))
    );
    const result = await tool.execute(
      { startDate: '2026-06-01', endDate: '2026-07-03' },
      toolCtx()
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toMatch(/31/);
    }
  });

  it('rejects AI-provided employeeId', async () => {
    const tool = createGetTimesheetRangeTool(
      makeDeps(mockClient(async () => {
        throw new Error('should not call');
      }))
    );
    const result = await tool.execute(
      {
        startDate: '2026-07-13',
        endDate: '2026-07-19',
        employeeId: 'HACK',
      },
      toolCtx()
    );
    expect(result.success).toBe(false);
  });

  it('malformed API response', async () => {
    const tool = createGetTimesheetRangeTool(
      makeDeps(
        mockClient(async () => ({
          success: true,
          data: { nope: true },
          status: 200,
          requestId: 'r1',
        }))
      )
    );
    const result = await tool.execute(
      { startDate: '2026-07-13', endDate: '2026-07-14' },
      toolCtx()
    );
    expect(result.success).toBe(false);
  });

  it('API error / auth / timeout', async () => {
    for (const err of [
      new UnexpectedApiError('fail', { status: 502 }),
      new AuthenticationError(),
      new TimeoutError(),
    ]) {
      const tool = createGetTimesheetRangeTool(
        makeDeps(
          mockClient(async () => {
            throw err;
          })
        )
      );
      const result = await tool.execute(
        { startDate: '2026-07-13', endDate: '2026-07-14' },
        toolCtx()
      );
      expect(result.success).toBe(false);
    }
  });

  it('abort signal', async () => {
    const ac = new AbortController();
    ac.abort();
    const tool = createGetTimesheetRangeTool(
      makeDeps(mockClient(async () => {
        throw new Error('should not call');
      }))
    );
    const result = await tool.execute(
      { startDate: '2026-07-13', endDate: '2026-07-14' },
      toolCtx(ac.signal)
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('cancelled');
    }
  });

  it('registered in default registry', () => {
    const registry = createDefaultToolRegistry();
    expect(registry.exists('get_timesheet_range')).toBe(true);
    expect(registry.exists('get_week_timesheet')).toBe(false);
  });
});

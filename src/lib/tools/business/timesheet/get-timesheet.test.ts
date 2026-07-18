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
  createGetTimesheetTool,
  parseDailyTimesheet,
} from '@/lib/tools/business/timesheet/get-timesheet';
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

const validDay = {
  date: '2026-07-17',
  entries: [{ hours: 3, projectName: 'Portal', description: 'API' }],
  totalHours: 3,
  remainingHours: 5,
  expectedHours: 8,
  submitted: false,
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
    conversationId: 'conv-day',
    signal,
  });
}

describe('parseDailyTimesheet', () => {
  it('parses totals and remaining hours', () => {
    const day = parseDailyTimesheet({
      date: '2026-07-17',
      entries: [{ hours: 2 }, { hours: 1 }],
    });
    expect(day.totalHours).toBe(3);
    expect(day.remainingHours).toBe(5);
    expect(day.submitted).toBe(false);
  });

  it('allows empty entries', () => {
    const day = parseDailyTimesheet({ date: '2026-07-17', entries: [] });
    expect(day.entries).toEqual([]);
    expect(day.totalHours).toBe(0);
    expect(day.remainingHours).toBe(8);
  });

  it('rejects malformed', () => {
    expect(() => parseDailyTimesheet({})).toThrow(/Malformed/);
  });
});

describe('get_timesheet tool', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('valid date with conversation identity and X-Employee-Id', async () => {
    const tool = createGetTimesheetTool(
      makeDeps(
        mockClient(async (path, options) => {
          expect(path).toBe(
            `${TIMESHEET_API_PATHS.timesheets}?date=2026-07-17`
          );
          expect(options?.headers?.['X-Employee-Id']).toBe('S1');
          return {
            success: true,
            data: validDay,
            status: 200,
            requestId: 'r1',
          };
        })
      )
    );
    const result = await tool.execute({ date: '2026-07-17' }, toolCtx());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({
        date: '2026-07-17',
        totalHours: 3,
        remainingHours: 5,
        submitted: false,
        employeeId: 'S1',
      });
    }
  });

  it('rejects invalid date format', async () => {
    const tool = createGetTimesheetTool(
      makeDeps(mockClient(async () => {
        throw new Error('should not call API');
      }))
    );
    const result = await tool.execute({ date: '17-07-2026' }, toolCtx());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('validation_error');
    }
  });

  it('rejects relative date strings', async () => {
    const tool = createGetTimesheetTool(
      makeDeps(mockClient(async () => {
        throw new Error('should not call API');
      }))
    );
    for (const date of ['today', 'yesterday', 'เมื่อวาน', 'this week']) {
      const result = await tool.execute({ date }, toolCtx());
      expect(result.success).toBe(false);
    }
  });

  it('rejects AI-provided employeeId', async () => {
    const tool = createGetTimesheetTool(
      makeDeps(mockClient(async () => {
        throw new Error('should not call API');
      }))
    );
    const result = await tool.execute(
      { date: '2026-07-17', employeeId: 'HACK' },
      toolCtx()
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toMatch(/employeeId/);
    }
  });

  it('malformed API response', async () => {
    const tool = createGetTimesheetTool(
      makeDeps(
        mockClient(async () => ({
          success: true,
          data: { entries: [] },
          status: 200,
          requestId: 'r1',
        }))
      )
    );
    const result = await tool.execute({ date: '2026-07-17' }, toolCtx());
    expect(result.success).toBe(false);
  });

  it('API error', async () => {
    const tool = createGetTimesheetTool(
      makeDeps(
        mockClient(async () => {
          throw new UnexpectedApiError('fail', { status: 502 });
        })
      )
    );
    const result = await tool.execute({ date: '2026-07-17' }, toolCtx());
    expect(result.success).toBe(false);
  });

  it('authentication failure', async () => {
    const tool = createGetTimesheetTool(
      makeDeps(
        mockClient(async () => {
          throw new AuthenticationError();
        })
      )
    );
    const result = await tool.execute({ date: '2026-07-17' }, toolCtx());
    expect(result.success).toBe(false);
  });

  it('timeout', async () => {
    const tool = createGetTimesheetTool(
      makeDeps(
        mockClient(async () => {
          throw new TimeoutError();
        })
      )
    );
    const result = await tool.execute({ date: '2026-07-17' }, toolCtx());
    expect(result.success).toBe(false);
  });

  it('abort signal', async () => {
    const ac = new AbortController();
    ac.abort();
    const tool = createGetTimesheetTool(
      makeDeps(mockClient(async () => {
        throw new Error('should not call');
      }))
    );
    const result = await tool.execute({ date: '2026-07-17' }, toolCtx(ac.signal));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('cancelled');
    }
  });

  it('registered in default registry', () => {
    const registry = createDefaultToolRegistry();
    expect(registry.exists('get_timesheet')).toBe(true);
    expect(registry.exists('get_today_timesheet')).toBe(false);
  });
});

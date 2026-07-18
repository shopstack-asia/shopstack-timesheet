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
  createGetTodayTimesheetTool,
  parseTodayTimesheet,
} from '@/lib/tools/business/timesheet/get-today-timesheet';
import { CS_CORE_PATHS } from '@/lib/tools/business/types';

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
      baseUrl: 'https://cs-core.test',
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

const validToday = {
  date: '2026-07-18',
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

function toolCtx() {
  return createToolContext({
    userId: 'U1',
    conversationId: 'conv-today',
  });
}

describe('parseTodayTimesheet', () => {
  it('parses and derives remaining hours', () => {
    const today = parseTodayTimesheet({
      date: '2026-07-18',
      entries: [{ hours: 2 }, { hours: 1 }],
    });
    expect(today.totalHours).toBe(3);
    expect(today.remainingHours).toBe(5);
  });

  it('rejects malformed', () => {
    expect(() => parseTodayTimesheet({})).toThrow(/Malformed/);
  });
});

describe('get_today_timesheet tool', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('success with identity from conversation context', async () => {
    const tool = createGetTodayTimesheetTool(
      makeDeps(
        mockClient(async (path, options) => {
          expect(path).toBe(CS_CORE_PATHS.todayTimesheet);
          expect(options?.headers?.['X-Employee-Id']).toBe('S1');
          return {
            success: true,
            data: validToday,
            status: 200,
            requestId: 'r1',
          };
        })
      )
    );
    const result = await tool.execute({}, toolCtx());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({
        date: '2026-07-18',
        employeeId: 'S1',
      });
    }
  });

  it('authentication failure', async () => {
    const tool = createGetTodayTimesheetTool(
      makeDeps(
        mockClient(async () => {
          throw new AuthenticationError();
        })
      )
    );
    const result = await tool.execute({}, toolCtx());
    expect(result.success).toBe(false);
  });

  it('API failure', async () => {
    const tool = createGetTodayTimesheetTool(
      makeDeps(
        mockClient(async () => {
          throw new UnexpectedApiError('fail', { status: 502 });
        })
      )
    );
    const result = await tool.execute({}, toolCtx());
    expect(result.success).toBe(false);
  });

  it('timeout', async () => {
    const tool = createGetTodayTimesheetTool(
      makeDeps(
        mockClient(async () => {
          throw new TimeoutError();
        })
      )
    );
    const result = await tool.execute({}, toolCtx());
    expect(result.success).toBe(false);
  });

  it('malformed response', async () => {
    const tool = createGetTodayTimesheetTool(
      makeDeps(
        mockClient(async () => ({
          success: true,
          data: { date: '2026-07-18' },
          status: 200,
          requestId: 'r1',
        }))
      )
    );
    const result = await tool.execute({}, toolCtx());
    expect(result.success).toBe(false);
  });

  it('registered with OpenAI schema', () => {
    const registry = createDefaultToolRegistry();
    expect(registry.exists('get_today_timesheet')).toBe(true);
  });
});

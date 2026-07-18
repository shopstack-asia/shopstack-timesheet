import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthenticationError,
  TimeoutError,
  UnexpectedApiError,
} from '@/lib/business/errors';
import type { BusinessApiClient } from '@/lib/business/client';
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
    get: (async (path, options) => impl(path, options)) as BusinessApiClient['get'],
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

describe('parseTodayTimesheet', () => {
  it('parses and derives remaining hours', () => {
    const today = parseTodayTimesheet({
      date: '2026-07-18',
      entries: [{ hours: 2 }, { hours: 1 }],
    });
    expect(today.totalHours).toBe(3);
    expect(today.remainingHours).toBe(5);
    expect(today.submitted).toBe(false);
  });

  it('rejects malformed', () => {
    expect(() => parseTodayTimesheet({})).toThrow(/Malformed/);
    expect(() =>
      parseTodayTimesheet({ date: '2026-07-18', entries: [{ hours: -1 }] })
    ).toThrow(/hours/);
  });
});

describe('get_today_timesheet tool', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('success', async () => {
    const tool = createGetTodayTimesheetTool({
      client: mockClient(async (path) => {
        expect(path).toBe(CS_CORE_PATHS.todayTimesheet);
        return {
          success: true,
          data: validToday,
          status: 200,
          requestId: 'r1',
        };
      }),
    });
    const result = await tool.execute({}, createToolContext());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({
        date: '2026-07-18',
        totalHours: 3,
        remainingHours: 5,
      });
    }
  });

  it('authentication failure', async () => {
    const tool = createGetTodayTimesheetTool({
      client: mockClient(async () => {
        throw new AuthenticationError();
      }),
    });
    const result = await tool.execute({}, createToolContext());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe('authentication');
  });

  it('API failure', async () => {
    const tool = createGetTodayTimesheetTool({
      client: mockClient(async () => {
        throw new UnexpectedApiError('fail', { status: 502 });
      }),
    });
    const result = await tool.execute({}, createToolContext());
    expect(result.success).toBe(false);
  });

  it('timeout', async () => {
    const tool = createGetTodayTimesheetTool({
      client: mockClient(async () => {
        throw new TimeoutError();
      }),
    });
    const result = await tool.execute({}, createToolContext());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe('timeout');
  });

  it('malformed response', async () => {
    const tool = createGetTodayTimesheetTool({
      client: mockClient(async () => ({
        success: true,
        data: { date: '2026-07-18' },
        status: 200,
        requestId: 'r1',
      })),
    });
    const result = await tool.execute({}, createToolContext());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe('validation_error');
  });

  it('registered with OpenAI schema', () => {
    const registry = createDefaultToolRegistry();
    expect(registry.exists('get_today_timesheet')).toBe(true);
    const def = registry
      .toLlmToolDefinitions()
      .find((d) => d.function.name === 'get_today_timesheet');
    expect(def?.function.description).toMatch(/today/i);
  });
});

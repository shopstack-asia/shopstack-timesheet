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
  createGetWeekTimesheetTool,
  parseWeekTimesheet,
} from '@/lib/tools/business/timesheet/get-week-timesheet';
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

const validWeek = {
  weekStart: '2026-07-13',
  weekEnd: '2026-07-19',
  days: [
    { date: '2026-07-13', totalHours: 8, submitted: true },
    { date: '2026-07-14', totalHours: 4, submitted: false },
  ],
  weeklyTotal: 12,
  submitted: false,
  submissionStatus: 'in_progress',
};

describe('parseWeekTimesheet', () => {
  it('parses and derives weekly total', () => {
    const week = parseWeekTimesheet({
      weekStart: '2026-07-13',
      days: [
        { date: '2026-07-13', totalHours: 8 },
        { date: '2026-07-14', totalHours: 2 },
      ],
    });
    expect(week.weeklyTotal).toBe(10);
  });

  it('rejects malformed', () => {
    expect(() => parseWeekTimesheet({ weekStart: 'x' })).toThrow(/Malformed/);
  });
});

describe('get_week_timesheet tool', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('success', async () => {
    const tool = createGetWeekTimesheetTool({
      client: mockClient(async (path) => {
        expect(path).toBe(CS_CORE_PATHS.weekTimesheet);
        return {
          success: true,
          data: validWeek,
          status: 200,
          requestId: 'r1',
        };
      }),
    });
    const result = await tool.execute({}, createToolContext());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({
        weekStart: '2026-07-13',
        weeklyTotal: 12,
        submitted: false,
      });
    }
  });

  it('authentication failure', async () => {
    const tool = createGetWeekTimesheetTool({
      client: mockClient(async () => {
        throw new AuthenticationError();
      }),
    });
    const result = await tool.execute({}, createToolContext());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe('authentication');
  });

  it('API failure', async () => {
    const tool = createGetWeekTimesheetTool({
      client: mockClient(async () => {
        throw new UnexpectedApiError('fail');
      }),
    });
    const result = await tool.execute({}, createToolContext());
    expect(result.success).toBe(false);
  });

  it('timeout', async () => {
    const tool = createGetWeekTimesheetTool({
      client: mockClient(async () => {
        throw new TimeoutError();
      }),
    });
    const result = await tool.execute({}, createToolContext());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe('timeout');
  });

  it('malformed response', async () => {
    const tool = createGetWeekTimesheetTool({
      client: mockClient(async () => ({
        success: true,
        data: { days: [] },
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
    expect(registry.exists('get_week_timesheet')).toBe(true);
    const def = registry
      .toLlmToolDefinitions()
      .find((d) => d.function.name === 'get_week_timesheet');
    expect(def?.function.description).toMatch(/week/i);
  });
});

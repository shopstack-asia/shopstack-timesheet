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
  buildSelectionHints,
  createGetWorkContextTool,
  parseWorkContext,
} from '@/lib/tools/business/context/get-work-context';
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

const validContext = {
  user: { id: 'u1', name: 'Ada' },
  clients: [
    {
      id: 'c1',
      name: 'Acme',
      projects: [
        {
          id: 'p1',
          name: 'Portal',
          roles: [{ id: 'r1', name: 'Dev' }],
        },
      ],
    },
  ],
};

describe('parseWorkContext / selection hints', () => {
  it('parses valid payload', () => {
    const ctx = parseWorkContext(validContext);
    expect(ctx.user.name).toBe('Ada');
    expect(ctx.clients[0]?.projects[0]?.roles[0]?.name).toBe('Dev');
  });

  it('rejects malformed response', () => {
    expect(() => parseWorkContext(null)).toThrow(/Malformed/);
    expect(() => parseWorkContext({ user: { id: 'u' } })).toThrow(/Malformed/);
  });

  it('auto-selects only when exactly one path', () => {
    const hints = buildSelectionHints(parseWorkContext(validContext));
    expect(hints.autoSelectable).toBe(true);
    expect(hints.singleRole?.id).toBe('r1');
  });

  it('asks user when multiple clients', () => {
    const hints = buildSelectionHints(
      parseWorkContext({
        ...validContext,
        clients: [
          validContext.clients[0],
          {
            id: 'c2',
            name: 'Beta',
            projects: [
              {
                id: 'p2',
                name: 'App',
                roles: [{ id: 'r2', name: 'QA' }],
              },
            ],
          },
        ],
      })
    );
    expect(hints.autoSelectable).toBe(false);
    expect(hints.message).toMatch(/Multiple clients/);
  });
});

describe('get_work_context tool', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('success path', async () => {
    const tool = createGetWorkContextTool({
      client: mockClient(async (path) => {
        expect(path).toBe(CS_CORE_PATHS.workContext);
        return {
          success: true,
          data: validContext,
          status: 200,
          requestId: 'r1',
        };
      }),
    });
    const result = await tool.execute(
      {},
      createToolContext({ requestId: 'r1' })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.result as { user: { name: string }; selection: { autoSelectable: boolean } };
      expect(data.user.name).toBe('Ada');
      expect(data.selection.autoSelectable).toBe(true);
    }
  });

  it('authentication failure', async () => {
    const tool = createGetWorkContextTool({
      client: mockClient(async () => {
        throw new AuthenticationError('nope', { requestId: 'r1' });
      }),
    });
    const result = await tool.execute({}, createToolContext());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('authentication');
    }
  });

  it('API failure', async () => {
    const tool = createGetWorkContextTool({
      client: mockClient(async () => {
        throw new UnexpectedApiError('boom', { status: 500, requestId: 'r1' });
      }),
    });
    const result = await tool.execute({}, createToolContext());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('unexpected');
    }
  });

  it('timeout', async () => {
    const tool = createGetWorkContextTool({
      client: mockClient(async () => {
        throw new TimeoutError('timed out', { requestId: 'r1' });
      }),
    });
    const result = await tool.execute({}, createToolContext());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('timeout');
    }
  });

  it('malformed response', async () => {
    const tool = createGetWorkContextTool({
      client: mockClient(async () => ({
        success: true,
        data: { broken: true },
        status: 200,
        requestId: 'r1',
      })),
    });
    const result = await tool.execute({}, createToolContext());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('validation_error');
    }
  });

  it('registered in default registry with OpenAI schema', () => {
    const registry = createDefaultToolRegistry();
    expect(registry.exists('get_work_context')).toBe(true);
    const def = registry
      .toLlmToolDefinitions()
      .find((d) => d.function.name === 'get_work_context');
    expect(def?.type).toBe('function');
    expect(def?.function.description).toMatch(/work context/i);
    expect(def?.function.parameters.type).toBe('object');
  });
});

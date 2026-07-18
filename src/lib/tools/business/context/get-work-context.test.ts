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
  createGetWorkContextTool,
  parseWorkContext,
  buildSelectionHints,
} from '@/lib/tools/business/context/get-work-context';
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

function toolCtx() {
  return createToolContext({
    requestId: 'r1',
    userId: 'U1',
    conversationId: 'conv-1',
    metadata: { slackUserId: 'U1', conversationId: 'conv-1' },
  });
}

function makeDeps(client: BusinessApiClient) {
  const identityResolver = createIdentityResolver({
    lookup: async () => ({
      ok: true,
      auth: {
        staff: {
          EmployeeID: 'S1',
          Email: 'ada@shopstack.asia',
          FirstName: 'Ada',
          LastName: 'Lovelace',
        },
      },
    }),
  });
  const contextManager = createContextManager({
    store: createContextStore(),
    identityResolver,
    businessClient: client,
  });
  return { client, contextManager };
}

describe('parseWorkContext / selection hints', () => {
  it('parses valid payload', () => {
    const ctx = parseWorkContext(validContext);
    expect(ctx.user.name).toBe('Ada');
  });

  it('rejects malformed response', () => {
    expect(() => parseWorkContext(null)).toThrow(/Malformed/);
  });

  it('auto-selects only when exactly one path', () => {
    expect(buildSelectionHints(parseWorkContext(validContext)).autoSelectable).toBe(
      true
    );
  });
});

describe('get_work_context tool', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('success path via conversation context', async () => {
    let calls = 0;
    const client = mockClient(async (path) => {
      calls += 1;
      expect(path).toBe(TIMESHEET_API_PATHS.workContext);
      return {
        success: true,
        data: validContext,
        status: 200,
        requestId: 'r1',
      };
    });
    const tool = createGetWorkContextTool(makeDeps(client));
    const result = await tool.execute({}, toolCtx());
    expect(result.success).toBe(true);
    expect(calls).toBe(1);
    if (result.success) {
      expect(result.result).toMatchObject({
        employeeId: 'S1',
        user: { name: 'Ada' },
      });
    }

    // Cache hit — second call does not hit API again
    const result2 = await tool.execute({}, toolCtx());
    expect(result2.success).toBe(true);
    expect(calls).toBe(1);
  });

  it('rejects AI-supplied employeeId', async () => {
    const client = mockClient(async () => ({
      success: true,
      data: validContext,
      status: 200,
      requestId: 'r1',
    }));
    const tool = createGetWorkContextTool(makeDeps(client));
    const result = await tool.execute({ employeeId: 'S999' }, toolCtx());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('validation_error');
    }
  });

  it('authentication failure', async () => {
    const client = mockClient(async () => {
      throw new AuthenticationError('nope', { requestId: 'r1' });
    });
    const tool = createGetWorkContextTool(makeDeps(client));
    const result = await tool.execute({}, toolCtx());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe('authentication');
  });

  it('API failure', async () => {
    const client = mockClient(async () => {
      throw new UnexpectedApiError('boom', { status: 500, requestId: 'r1' });
    });
    const tool = createGetWorkContextTool(makeDeps(client));
    const result = await tool.execute({}, toolCtx());
    expect(result.success).toBe(false);
  });

  it('timeout', async () => {
    const client = mockClient(async () => {
      throw new TimeoutError('timed out', { requestId: 'r1' });
    });
    const tool = createGetWorkContextTool(makeDeps(client));
    const result = await tool.execute({}, toolCtx());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe('timeout');
  });

  it('malformed response', async () => {
    const client = mockClient(async () => ({
      success: true,
      data: { broken: true },
      status: 200,
      requestId: 'r1',
    }));
    const tool = createGetWorkContextTool(makeDeps(client));
    const result = await tool.execute({}, toolCtx());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorCode).toBe('validation_error');
  });

  it('registered in default registry with OpenAI schema', () => {
    const registry = createDefaultToolRegistry();
    expect(registry.exists('get_work_context')).toBe(true);
    const def = registry
      .toLlmToolDefinitions()
      .find((d) => d.function.name === 'get_work_context');
    expect(def?.function.description).toMatch(/work context/i);
  });
});

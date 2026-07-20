import { describe, expect, it, vi } from 'vitest';
import type { BusinessApiClient } from '@/lib/business/client';
import {
  buildConversationId,
  createContextManager,
} from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import {
  createIdentityResolver,
  IdentityResolutionError,
} from '@/lib/conversation/context/identity-resolver';
import { TIMESHEET_API_PATHS } from '@/lib/tools/business/types';

const workPayload = {
  user: { id: 'u1', name: 'Ada' },
  clients: [
    {
      id: 'c1',
      name: 'Acme',
      projects: [
        {
          id: 'p1',
          name: 'Portal',
          roles: [
            { id: 'r1', name: 'Dev' },
            { id: 'r2', name: 'QA' },
          ],
        },
      ],
    },
  ],
};

function mockApi(getImpl: BusinessApiClient['get']): BusinessApiClient {
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
    get: getImpl,
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

describe('identity resolver', () => {
  it('resolves Slack → Zoho employee', async () => {
    const resolver = createIdentityResolver({
      lookup: async (slackUserId) => ({
        ok: true,
        auth: {
          staff: {
            EmployeeID: 'S42',
            Email: 'x@shopstack.asia',
            FirstName: 'X',
            LastName: 'Y',
          },
          slackUserId,
        },
      }),
    });
    const id = await resolver.resolveEmployee('U42');
    expect(id).toEqual({
      slackUserId: 'U42',
      slackEmail: 'x@shopstack.asia',
      employeeId: 'S42',
      employeeName: 'X Y',
      firstName: 'X',
      lastName: 'Y',
    });
  });

  it('captures Zoho Position for Time Log denormalized columns', async () => {
    const resolver = createIdentityResolver({
      lookup: async (slackUserId) => ({
        ok: true,
        auth: {
          staff: {
            EmployeeID: 'S42',
            Email: 'x@shopstack.asia',
            FirstName: 'X',
            LastName: 'Y',
            Position: 'Engineer',
          },
          slackUserId,
        },
      }),
    });
    const id = await resolver.resolveEmployee('U42');
    expect(id.position).toBe('Engineer');
    expect(id.firstName).toBe('X');
    expect(id.lastName).toBe('Y');
  });

  it('employee lookup failure', async () => {
    const resolver = createIdentityResolver({
      lookup: async () => ({ ok: false, message: 'No Zoho employee' }),
    });
    await expect(resolver.resolveEmployee('U1')).rejects.toBeInstanceOf(
      IdentityResolutionError
    );
  });
});

describe('conversation context manager', () => {
  it('stores Zoho staff name fields on identity cache miss', async () => {
    const manager = createContextManager({
      store: createContextStore(),
      identityResolver: createIdentityResolver({
        lookup: async () => ({
          ok: true,
          auth: {
            staff: {
              EmployeeID: 'S1',
              Email: 'a@shopstack.asia',
              FirstName: 'Ada',
              LastName: 'Lovelace',
              Position: 'Engineer',
            },
          },
        }),
      }),
      businessClient: mockApi(async () => {
        throw new Error('not used');
      }),
    });

    const ctx = await manager.getConversationContext({
      conversationId: 'c-staff',
      slackUserId: 'U1',
    });
    expect(ctx).toMatchObject({
      employeeId: 'S1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      position: 'Engineer',
      employeeName: 'Ada Lovelace',
    });
  });

  it('cache miss then cache hit for work context', async () => {
    let apiCalls = 0;
    const client = mockApi(
      (async () => {
        apiCalls += 1;
        return {
          success: true as const,
          data: workPayload,
          status: 200,
          requestId: 'r1',
        };
      }) as BusinessApiClient['get']
    );

    const manager = createContextManager({
      store: createContextStore(),
      identityResolver: createIdentityResolver({
        lookup: async () => ({
          ok: true,
          auth: {
            staff: { EmployeeID: 'S1', Email: 'a@shopstack.asia' },
          },
        }),
      }),
      businessClient: client,
    });

    const a = await manager.getConversationContext({
      conversationId: 'c1',
      slackUserId: 'U1',
      ensureWorkContext: true,
    });
    expect(a.employeeId).toBe('S1');
    expect(a.workContext?.user.name).toBe('Ada');
    expect(apiCalls).toBe(1);

    const b = await manager.getConversationContext({
      conversationId: 'c1',
      slackUserId: 'U1',
      ensureWorkContext: true,
    });
    expect(b.workContext?.user.name).toBe('Ada');
    expect(apiCalls).toBe(1);
  });

  it('refresh context reloads and clears selection', async () => {
    let apiCalls = 0;
    const client = mockApi(
      (async () => {
        apiCalls += 1;
        return {
          success: true as const,
          data: workPayload,
          status: 200,
          requestId: 'r1',
        };
      }) as BusinessApiClient['get']
    );
    const manager = createContextManager({
      store: createContextStore(),
      identityResolver: createIdentityResolver({
        lookup: async () => ({
          ok: true,
          auth: {
            staff: { EmployeeID: 'S1', Email: 'a@shopstack.asia' },
          },
        }),
      }),
      businessClient: client,
    });

    await manager.getConversationContext({
      conversationId: 'c1',
      slackUserId: 'U1',
      ensureWorkContext: true,
    });
    manager.selectClient('c1', { id: 'c1', name: 'Acme' });
    manager.selectProject('c1', { id: 'p1', name: 'Portal' });
    manager.selectRole('c1', { id: 'r1', name: 'Dev' });

    const refreshed = await manager.getConversationContext({
      conversationId: 'c1',
      slackUserId: 'U1',
      forceRefreshWorkContext: true,
    });
    expect(apiCalls).toBe(2);
    expect(refreshed.selectedClient).toBeUndefined();
    expect(refreshed.selectedProject).toBeUndefined();
    expect(refreshed.selectedRole).toBeUndefined();
  });

  it('context invalidation on client/project change', async () => {
    const manager = createContextManager({
      store: createContextStore(),
      identityResolver: createIdentityResolver({
        lookup: async () => ({
          ok: true,
          auth: {
            staff: { EmployeeID: 'S1', Email: 'a@shopstack.asia' },
          },
        }),
      }),
      businessClient: mockApi(
        (async () => ({
          success: true as const,
          data: workPayload,
          status: 200,
          requestId: 'r',
        })) as BusinessApiClient['get']
      ),
    });

    await manager.getConversationContext({
      conversationId: 'c1',
      slackUserId: 'U1',
      ensureWorkContext: true,
    });
    manager.selectClient('c1', { id: 'c1', name: 'Acme' });
    manager.selectProject('c1', { id: 'p1', name: 'Portal' });
    manager.selectRole('c1', { id: 'r1', name: 'Dev' });

    const afterClient = manager.selectClient('c1', {
      id: 'c1',
      name: 'Acme',
    });
    expect(afterClient.selectedProject).toBeUndefined();
    expect(afterClient.selectedRole).toBeUndefined();

    manager.selectProject('c1', { id: 'p1', name: 'Portal' });
    manager.selectRole('c1', { id: 'r1', name: 'Dev' });
    const afterProject = manager.selectProject('c1', {
      id: 'p1',
      name: 'Portal',
    });
    expect(afterProject.selectedRole).toBeUndefined();
  });

  it('conversation isolation across concurrent conversations', async () => {
    const manager = createContextManager({
      store: createContextStore(),
      identityResolver: createIdentityResolver({
        lookup: async (slackUserId) => ({
          ok: true,
          auth: {
            staff: {
              EmployeeID: slackUserId === 'U1' ? 'S1' : 'S2',
              Email:
                slackUserId === 'U1'
                  ? 'a@shopstack.asia'
                  : 'b@shopstack.asia',
            },
          },
        }),
      }),
    });

    const [a, b] = await Promise.all([
      manager.getConversationContext({
        conversationId: 'conv-a',
        slackUserId: 'U1',
      }),
      manager.getConversationContext({
        conversationId: 'conv-b',
        slackUserId: 'U2',
      }),
    ]);
    expect(a.employeeId).toBe('S1');
    expect(b.employeeId).toBe('S2');
    expect(manager.peek('conv-a')?.employeeId).toBe('S1');
    expect(manager.peek('conv-b')?.employeeId).toBe('S2');
  });

  it('rejects mismatched slack user on same conversation id', async () => {
    const manager = createContextManager({
      store: createContextStore(),
      identityResolver: createIdentityResolver({
        lookup: async (slackUserId) => ({
          ok: true,
          auth: {
            staff: {
              EmployeeID: slackUserId,
              Email: `${slackUserId}@shopstack.asia`,
            },
          },
        }),
      }),
    });

    await manager.getConversationContext({
      conversationId: 'shared',
      slackUserId: 'U1',
    });
    const next = await manager.getConversationContext({
      conversationId: 'shared',
      slackUserId: 'U2',
    });
    expect(next.employeeId).toBe('U2');
  });

  it('cache expiry', async () => {
    let now = 1_000_000;
    const store = createContextStore({
      ttlMs: 100,
      now: () => now,
    });
    const manager = createContextManager({
      store,
      identityResolver: createIdentityResolver({
        lookup: async () => ({
          ok: true,
          auth: {
            staff: { EmployeeID: 'S1', Email: 'a@shopstack.asia' },
          },
        }),
      }),
    });

    await manager.getConversationContext({
      conversationId: 'exp',
      slackUserId: 'U1',
    });
    expect(manager.peek('exp')).toBeTruthy();
    now += 200;
    expect(manager.peek('exp')).toBeUndefined();
  });

  it('buildConversationId is stable', () => {
    expect(
      buildConversationId({
        channel: 'D1',
        slackUserId: 'U1',
      })
    ).toBe('slack:D1:U1');
    expect(
      buildConversationId({
        channel: 'C1',
        threadTs: '123.4',
        slackUserId: 'U1',
      })
    ).toBe('slack:C1:123.4:U1');
  });

  it('passes X-Employee-Id when loading work context', async () => {
    const get = vi.fn(async (_path: string, options?: { headers?: Record<string, string> }) => {
      expect(options?.headers?.['X-Employee-Id']).toBe('S9');
      return {
        success: true as const,
        data: workPayload,
        status: 200,
        requestId: 'r',
      };
    });
    const manager = createContextManager({
      store: createContextStore(),
      identityResolver: createIdentityResolver({
        lookup: async () => ({
          ok: true,
          auth: {
            staff: { EmployeeID: 'S9', Email: 'a@shopstack.asia' },
          },
        }),
      }),
      businessClient: mockApi(get as BusinessApiClient['get']),
    });
    await manager.getConversationContext({
      conversationId: 'c',
      slackUserId: 'U1',
      ensureWorkContext: true,
    });
    expect(get).toHaveBeenCalledWith(
      TIMESHEET_API_PATHS.workContext,
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Employee-Id': 'S9' }),
      })
    );
  });
});

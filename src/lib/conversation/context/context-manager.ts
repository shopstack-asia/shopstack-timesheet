import type { BusinessApiClient } from '@/lib/business/client';
import { createBusinessApiClient } from '@/lib/business/client';
import {
  getDefaultContextStore,
  type ContextStore,
} from '@/lib/conversation/context/context-store';
import {
  createIdentityResolver,
  getDefaultIdentityResolver,
  IdentityResolutionError,
  type IdentityResolver,
} from '@/lib/conversation/context/identity-resolver';
import type {
  ConversationContext,
  GetConversationContextOptions,
  SelectedRef,
} from '@/lib/conversation/context/types';
import { parseWorkContext } from '@/lib/tools/business/context/work-context-parse';
import { CS_CORE_PATHS } from '@/lib/tools/business/types';

export type ContextManagerDeps = {
  store?: ContextStore;
  identityResolver?: IdentityResolver;
  businessClient?: BusinessApiClient;
};

export type GetConversationContextInput = {
  conversationId: string;
  slackUserId: string;
  requestId?: string;
  signal?: AbortSignal;
} & GetConversationContextOptions;

function cloneContext(ctx: ConversationContext): ConversationContext {
  return {
    ...ctx,
    workContext: ctx.workContext
      ? structuredClone(ctx.workContext)
      : undefined,
    selectedClient: ctx.selectedClient
      ? { ...ctx.selectedClient }
      : undefined,
    selectedProject: ctx.selectedProject
      ? { ...ctx.selectedProject }
      : undefined,
    selectedRole: ctx.selectedRole ? { ...ctx.selectedRole } : undefined,
    loadedAt: new Date(ctx.loadedAt),
  };
}

async function loadWorkContext(
  client: BusinessApiClient,
  employeeId: string,
  requestId?: string,
  signal?: AbortSignal
) {
  const response = await client.get<unknown>(CS_CORE_PATHS.workContext, {
    requestId,
    signal,
    idempotent: true,
    headers: {
      'X-Employee-Id': employeeId,
    },
  });
  return parseWorkContext(response.data);
}

/**
 * Conversation Context Manager — identity + smart work-context cache.
 * Business tools must use getConversationContext(); never resolve identity themselves.
 */
export function createContextManager(deps: ContextManagerDeps = {}) {
  const store = deps.store ?? getDefaultContextStore();
  const identityResolver =
    deps.identityResolver ?? getDefaultIdentityResolver();
  const businessClient = deps.businessClient;

  function resolveClient(): BusinessApiClient {
    return businessClient ?? createBusinessApiClient();
  }

  async function getConversationContext(
    input: GetConversationContextInput
  ): Promise<ConversationContext> {
    const conversationId = input.conversationId?.trim();
    const slackUserId = input.slackUserId?.trim();
    if (!conversationId) {
      throw new IdentityResolutionError('Missing conversationId');
    }
    if (!slackUserId) {
      throw new IdentityResolutionError('Missing slackUserId');
    }

    let ctx = store.get(conversationId);

    // Isolation: never reuse another user's cached context
    if (ctx && ctx.slackUserId !== slackUserId) {
      store.delete(conversationId);
      ctx = undefined;
    }

    if (!ctx) {
      const identity = await identityResolver.resolveEmployee(slackUserId);
      ctx = {
        conversationId,
        slackUserId: identity.slackUserId,
        slackEmail: identity.slackEmail,
        employeeId: identity.employeeId,
        loadedAt: new Date(),
      };
      store.set(ctx);
    }

    if (input.forceRefreshWorkContext) {
      const workContext = await loadWorkContext(
        resolveClient(),
        ctx.employeeId,
        input.requestId,
        input.signal
      );
      ctx = {
        ...ctx,
        workContext,
        selectedClient: undefined,
        selectedProject: undefined,
        selectedRole: undefined,
        loadedAt: new Date(),
      };
      store.set(ctx);
      return cloneContext(ctx);
    }

    if (input.ensureWorkContext && !ctx.workContext) {
      const workContext = await loadWorkContext(
        resolveClient(),
        ctx.employeeId,
        input.requestId,
        input.signal
      );
      ctx = {
        ...ctx,
        workContext,
        loadedAt: new Date(),
      };
      store.set(ctx);
    }

    return cloneContext(ctx);
  }

  function selectClient(
    conversationId: string,
    client: SelectedRef
  ): ConversationContext {
    const ctx = store.get(conversationId);
    if (!ctx) {
      throw new IdentityResolutionError('Conversation context not found');
    }
    const next: ConversationContext = {
      ...ctx,
      selectedClient: { ...client },
      selectedProject: undefined,
      selectedRole: undefined,
    };
    store.set(next);
    return cloneContext(next);
  }

  function selectProject(
    conversationId: string,
    project: SelectedRef
  ): ConversationContext {
    const ctx = store.get(conversationId);
    if (!ctx) {
      throw new IdentityResolutionError('Conversation context not found');
    }
    const next: ConversationContext = {
      ...ctx,
      selectedProject: { ...project },
      selectedRole: undefined,
    };
    store.set(next);
    return cloneContext(next);
  }

  function selectRole(
    conversationId: string,
    role: SelectedRef
  ): ConversationContext {
    const ctx = store.get(conversationId);
    if (!ctx) {
      throw new IdentityResolutionError('Conversation context not found');
    }
    const next: ConversationContext = {
      ...ctx,
      selectedRole: { ...role },
    };
    store.set(next);
    return cloneContext(next);
  }

  function peek(conversationId: string): ConversationContext | undefined {
    const ctx = store.get(conversationId);
    return ctx ? cloneContext(ctx) : undefined;
  }

  function clear(conversationId: string): void {
    store.delete(conversationId);
  }

  return {
    getConversationContext,
    selectClient,
    selectProject,
    selectRole,
    peek,
    clear,
    store,
  };
}

export type ContextManager = ReturnType<typeof createContextManager>;

let defaultManager: ContextManager | null = null;

export function getDefaultContextManager(): ContextManager {
  if (!defaultManager) {
    defaultManager = createContextManager();
  }
  return defaultManager;
}

export function resetDefaultContextManager(): void {
  defaultManager = null;
}

/** Convenience: getConversationContext via default manager. */
export async function getConversationContext(
  input: GetConversationContextInput
): Promise<ConversationContext> {
  return getDefaultContextManager().getConversationContext(input);
}

/**
 * Build a stable conversation id from Slack channel + thread.
 * DMs use channel; threaded mentions use thread_ts.
 */
export function buildConversationId(args: {
  channel: string;
  threadTs?: string;
  slackUserId: string;
}): string {
  const channel = args.channel.trim();
  const thread = args.threadTs?.trim();
  // Include user so DM-shared channels still isolate per user if needed
  if (thread) {
    return `slack:${channel}:${thread}:${args.slackUserId.trim()}`;
  }
  return `slack:${channel}:${args.slackUserId.trim()}`;
}

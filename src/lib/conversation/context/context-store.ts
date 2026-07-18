import type { ConversationContext } from '@/lib/conversation/context/types';

export type ContextStore = {
  get(conversationId: string): ConversationContext | undefined;
  set(context: ConversationContext): void;
  delete(conversationId: string): void;
  clear(): void;
  size(): number;
};

export type ContextStoreOptions = {
  /** Entry TTL in ms (default 30 minutes). */
  ttlMs?: number;
  /** Clock for tests. */
  now?: () => number;
};

type StoreEntry = {
  context: ConversationContext;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;

/**
 * In-memory conversation context store.
 * Isolated instances via createContextStore(); optional process default for runtime.
 */
export function createContextStore(
  options: ContextStoreOptions = {}
): ContextStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const map = new Map<string, StoreEntry>();

  function purgeExpired(): void {
    const t = now();
    for (const [id, entry] of map) {
      if (entry.expiresAt <= t) {
        map.delete(id);
      }
    }
  }

  return {
    get(conversationId) {
      purgeExpired();
      const entry = map.get(conversationId);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        map.delete(conversationId);
        return undefined;
      }
      return entry.context;
    },
    set(context) {
      map.set(context.conversationId, {
        context,
        expiresAt: now() + ttlMs,
      });
    },
    delete(conversationId) {
      map.delete(conversationId);
    },
    clear() {
      map.clear();
    },
    size() {
      purgeExpired();
      return map.size;
    },
  };
}

let defaultStore: ContextStore | null = null;

export function getDefaultContextStore(): ContextStore {
  if (!defaultStore) {
    defaultStore = createContextStore();
  }
  return defaultStore;
}

/** Reset default store (tests). */
export function resetDefaultContextStore(): void {
  defaultStore = null;
}

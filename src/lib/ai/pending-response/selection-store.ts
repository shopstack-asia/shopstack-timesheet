/**
 * Redis-backed selected-pending target + displayed-choice snapshot.
 * In-memory Map is test-double only — never production default.
 */

import { getRedisClient, type RedisAdapter } from '@/lib/redis';
import {
  parseChoiceSnapshot,
  parseSelectedTarget,
  pendingChoicesKey,
  selectedPendingKey,
  ttlSecondsUntil,
  type PendingChoiceSnapshot,
  type SelectedPendingTimesheetTarget,
} from '@/lib/ai/pending-response/selection-types';

export type SelectedPendingStore = {
  getSelected(
    conversationId: string,
    slackUserId: string,
    employeeId: string,
    nowMs?: number
  ): Promise<
    | { outcome: 'found'; target: SelectedPendingTimesheetTarget }
    | { outcome: 'not_found' }
    | { outcome: 'expired' }
    | { outcome: 'unavailable' }
  >;
  setSelected(
    target: SelectedPendingTimesheetTarget,
    nowMs?: number
  ): Promise<{ outcome: 'ok' } | { outcome: 'unavailable' }>;
  clearSelected(
    conversationId: string,
    slackUserId: string
  ): Promise<{ outcome: 'ok' } | { outcome: 'unavailable' }>;
  getChoices(
    conversationId: string,
    slackUserId: string,
    employeeId: string,
    nowMs?: number
  ): Promise<
    | { outcome: 'found'; snapshot: PendingChoiceSnapshot }
    | { outcome: 'not_found' }
    | { outcome: 'expired' }
    | { outcome: 'unavailable' }
  >;
  setChoices(
    snapshot: PendingChoiceSnapshot,
    nowMs?: number
  ): Promise<{ outcome: 'ok' } | { outcome: 'unavailable' }>;
  clearChoices(
    conversationId: string,
    slackUserId: string
  ): Promise<{ outcome: 'ok' } | { outcome: 'unavailable' }>;
  /** Clear both selected target and choice snapshot. */
  clearAll(
    conversationId: string,
    slackUserId: string
  ): Promise<{ outcome: 'ok' } | { outcome: 'unavailable' }>;
};

type SelRedis = Pick<RedisAdapter, 'get' | 'setex' | 'del'>;

function wrapUnavailable(): { outcome: 'unavailable' } {
  return { outcome: 'unavailable' };
}

export function createRedisSelectedPendingStore(
  redis?: SelRedis
): SelectedPendingStore {
  function client(): SelRedis {
    return redis ?? getRedisClient();
  }

  return {
    async getSelected(conversationId, slackUserId, employeeId, nowMs = Date.now()) {
      try {
        const key = selectedPendingKey(conversationId, slackUserId);
        const raw = await client().get<unknown>(key);
        if (!raw) return { outcome: 'not_found' };
        const target = parseSelectedTarget(raw);
        if (!target) {
          await client().del(key);
          return { outcome: 'not_found' };
        }
        if (
          target.conversationId !== conversationId ||
          target.slackUserId !== slackUserId ||
          target.employeeId !== employeeId
        ) {
          await client().del(key);
          return { outcome: 'not_found' };
        }
        if (new Date(target.expiresAt).getTime() <= nowMs) {
          await client().del(key);
          return { outcome: 'expired' };
        }
        return { outcome: 'found', target };
      } catch {
        return wrapUnavailable();
      }
    },

    async setSelected(target, nowMs = Date.now()) {
      try {
        const ttl = ttlSecondsUntil(target.expiresAt, nowMs);
        await client().setex(
          selectedPendingKey(target.conversationId, target.slackUserId),
          ttl,
          JSON.stringify(target)
        );
        return { outcome: 'ok' };
      } catch {
        return wrapUnavailable();
      }
    },

    async clearSelected(conversationId, slackUserId) {
      try {
        await client().del(selectedPendingKey(conversationId, slackUserId));
        return { outcome: 'ok' };
      } catch {
        return wrapUnavailable();
      }
    },

    async getChoices(conversationId, slackUserId, employeeId, nowMs = Date.now()) {
      try {
        const key = pendingChoicesKey(conversationId, slackUserId);
        const raw = await client().get<unknown>(key);
        if (!raw) return { outcome: 'not_found' };
        const snapshot = parseChoiceSnapshot(raw);
        if (!snapshot) {
          await client().del(key);
          return { outcome: 'not_found' };
        }
        if (
          snapshot.conversationId !== conversationId ||
          snapshot.slackUserId !== slackUserId ||
          snapshot.employeeId !== employeeId
        ) {
          await client().del(key);
          return { outcome: 'not_found' };
        }
        if (new Date(snapshot.expiresAt).getTime() <= nowMs) {
          await client().del(key);
          return { outcome: 'expired' };
        }
        return { outcome: 'found', snapshot };
      } catch {
        return wrapUnavailable();
      }
    },

    async setChoices(snapshot, nowMs = Date.now()) {
      try {
        const ttl = ttlSecondsUntil(snapshot.expiresAt, nowMs);
        await client().setex(
          pendingChoicesKey(snapshot.conversationId, snapshot.slackUserId),
          ttl,
          JSON.stringify(snapshot)
        );
        return { outcome: 'ok' };
      } catch {
        return wrapUnavailable();
      }
    },

    async clearChoices(conversationId, slackUserId) {
      try {
        await client().del(pendingChoicesKey(conversationId, slackUserId));
        return { outcome: 'ok' };
      } catch {
        return wrapUnavailable();
      }
    },

    async clearAll(conversationId, slackUserId) {
      try {
        await client().del(selectedPendingKey(conversationId, slackUserId));
        await client().del(pendingChoicesKey(conversationId, slackUserId));
        return { outcome: 'ok' };
      } catch {
        return wrapUnavailable();
      }
    },
  };
}

/** Explicit test double only — never the production default. */
export function createInMemorySelectedPendingStore(): SelectedPendingStore {
  const data = new Map<string, unknown>();

  return createRedisSelectedPendingStore({
    async get<T>(key: string): Promise<T | null> {
      const v = data.get(key);
      return (v === undefined ? null : (v as T)) ?? null;
    },
    async setex(key, _ttl, value) {
      data.set(key, JSON.parse(value) as unknown);
    },
    async del(key) {
      data.delete(key);
    },
  });
}

let defaultStore: SelectedPendingStore | null = null;

export function getDefaultSelectedPendingStore(): SelectedPendingStore {
  if (!defaultStore) {
    defaultStore = createRedisSelectedPendingStore();
  }
  return defaultStore;
}

export function setDefaultSelectedPendingStore(
  store: SelectedPendingStore | null
): void {
  defaultStore = store;
}

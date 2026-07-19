import { getRedisClient, type RedisAdapter } from '@/lib/redis';
import {
  INTENT_DRAFT_TTL_SECONDS,
  type IntentDraft,
  type IntentMissingField,
  type StructuredIntentName,
} from '@/lib/ai/intent/types';

export type DraftStoreOutcome =
  | 'draft_store_unavailable'
  | 'draft_not_found'
  | 'draft_expired'
  | 'draft_ownership_mismatch'
  | 'draft_saved'
  | 'draft_cleared'
  | 'draft_found';

export class DraftStoreError extends Error {
  readonly code = 'draft_store_unavailable' as const;

  constructor(message = 'Intent draft store unavailable') {
    super(message);
    this.name = 'DraftStoreError';
  }
}

export type DraftGetResult =
  | { outcome: 'draft_found'; draft: IntentDraft }
  | { outcome: 'draft_not_found' }
  | { outcome: 'draft_expired' }
  | { outcome: 'draft_store_unavailable' };

export type DraftWriteResult =
  | { outcome: 'draft_saved' }
  | { outcome: 'draft_cleared' }
  | { outcome: 'draft_not_found' }
  | { outcome: 'draft_store_unavailable' };

export type IntentDraftStore = {
  get(conversationId: string, slackUserId: string): Promise<DraftGetResult>;
  set(draft: IntentDraft): Promise<DraftWriteResult>;
  clear(conversationId: string, slackUserId: string): Promise<DraftWriteResult>;
};

/**
 * Redis key scoped by conversation AND trusted Slack user.
 * Both components are URI-encoded to keep keys safe.
 */
export function intentDraftKey(
  conversationId: string,
  slackUserId: string
): string {
  const c = encodeURIComponent(conversationId.trim());
  const u = encodeURIComponent(slackUserId.trim());
  return `timesheet:intent-draft:${c}:${u}`;
}

type DraftRedis = Pick<RedisAdapter, 'get' | 'setex' | 'del'>;

function wrapRedisFailure(error: unknown): DraftStoreError {
  if (error instanceof DraftStoreError) return error;
  return new DraftStoreError(
    error instanceof Error ? error.message : 'Redis draft store unavailable'
  );
}

export function createRedisIntentDraftStore(
  redis?: DraftRedis
): IntentDraftStore {
  function client(): DraftRedis {
    try {
      return redis ?? getRedisClient();
    } catch (error) {
      throw wrapRedisFailure(error);
    }
  }

  return {
    async get(conversationId, slackUserId) {
      try {
        const key = intentDraftKey(conversationId, slackUserId);
        const raw = await client().get<IntentDraft>(key);
        if (!raw) return { outcome: 'draft_not_found' };
        if (raw.slackUserId !== slackUserId) {
          return { outcome: 'draft_not_found' };
        }
        if (new Date(raw.expiresAt).getTime() <= Date.now()) {
          await client().del(key);
          return { outcome: 'draft_expired' };
        }
        return { outcome: 'draft_found', draft: raw };
      } catch (error) {
        if (error instanceof DraftStoreError) {
          return { outcome: 'draft_store_unavailable' };
        }
        return { outcome: 'draft_store_unavailable' };
      }
    },

    async set(draft) {
      try {
        const key = intentDraftKey(draft.conversationId, draft.slackUserId);
        await client().setex(
          key,
          INTENT_DRAFT_TTL_SECONDS,
          JSON.stringify(draft)
        );
        return { outcome: 'draft_saved' };
      } catch {
        return { outcome: 'draft_store_unavailable' };
      }
    },

    async clear(conversationId, slackUserId) {
      try {
        const key = intentDraftKey(conversationId, slackUserId);
        const existing = await client().get<IntentDraft>(key);
        if (!existing || existing.slackUserId !== slackUserId) {
          return { outcome: 'draft_not_found' };
        }
        await client().del(key);
        return { outcome: 'draft_cleared' };
      } catch {
        return { outcome: 'draft_store_unavailable' };
      }
    },
  };
}

/** In-memory draft store for tests only — never production default. */
export function createInMemoryIntentDraftStore(): IntentDraftStore {
  const byKey = new Map<string, IntentDraft>();
  return {
    async get(conversationId, slackUserId) {
      const key = intentDraftKey(conversationId, slackUserId);
      const raw = byKey.get(key);
      if (!raw) return { outcome: 'draft_not_found' };
      if (raw.slackUserId !== slackUserId) {
        return { outcome: 'draft_not_found' };
      }
      if (new Date(raw.expiresAt).getTime() <= Date.now()) {
        byKey.delete(key);
        return { outcome: 'draft_expired' };
      }
      return {
        outcome: 'draft_found',
        draft: { ...raw, missingFields: [...raw.missingFields] },
      };
    },
    async set(draft) {
      const key = intentDraftKey(draft.conversationId, draft.slackUserId);
      byKey.set(key, {
        ...draft,
        missingFields: [...draft.missingFields],
      });
      return { outcome: 'draft_saved' };
    },
    async clear(conversationId, slackUserId) {
      const key = intentDraftKey(conversationId, slackUserId);
      const raw = byKey.get(key);
      if (!raw || raw.slackUserId !== slackUserId) {
        return { outcome: 'draft_not_found' };
      }
      byKey.delete(key);
      return { outcome: 'draft_cleared' };
    },
  };
}

export function buildDraftFromSlots(input: {
  intent: StructuredIntentName;
  conversationId: string;
  slackUserId: string;
  dateExpression?: string;
  resolvedDate?: string;
  projectHint?: string;
  resolvedProjectId?: string;
  taskHint?: string;
  resolvedTaskId?: string;
  hours?: number;
  missingFields: IntentMissingField[];
  now?: Date;
}): IntentDraft {
  const wall = new Date();
  return {
    intent: input.intent,
    conversationId: input.conversationId,
    slackUserId: input.slackUserId,
    dateExpression: input.dateExpression,
    resolvedDate: input.resolvedDate,
    projectHint: input.projectHint,
    resolvedProjectId: input.resolvedProjectId,
    taskHint: input.taskHint,
    resolvedTaskId: input.resolvedTaskId,
    hours: input.hours,
    missingFields: input.missingFields,
    createdAt: wall.toISOString(),
    expiresAt: new Date(
      wall.getTime() + INTENT_DRAFT_TTL_SECONDS * 1000
    ).toISOString(),
  };
}

export function draftSummary(draft: IntentDraft): string {
  return JSON.stringify({
    intent: draft.intent,
    dateExpression: draft.dateExpression,
    resolvedDate: draft.resolvedDate,
    projectHint: draft.projectHint,
    taskHint: draft.taskHint,
    hours: draft.hours,
    missingFields: draft.missingFields,
  });
}

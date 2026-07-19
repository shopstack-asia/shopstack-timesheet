import { getRedisClient, type RedisAdapter } from '@/lib/redis';
import {
  INTENT_DRAFT_TTL_SECONDS,
  type IntentDraft,
  type IntentMissingField,
  type StructuredIntentName,
} from '@/lib/ai/intent/types';

export type IntentDraftStore = {
  get(conversationId: string, slackUserId: string): Promise<IntentDraft | undefined>;
  set(draft: IntentDraft): Promise<void>;
  clear(conversationId: string, slackUserId: string): Promise<void>;
};

export function intentDraftKey(conversationId: string): string {
  return `timesheet:intent-draft:${conversationId}`;
}

type DraftRedis = Pick<RedisAdapter, 'get' | 'setex' | 'del'>;

export function createRedisIntentDraftStore(
  redis?: DraftRedis
): IntentDraftStore {
  function client(): DraftRedis {
    return redis ?? getRedisClient();
  }

  return {
    async get(conversationId, slackUserId) {
      const raw = await client().get<IntentDraft>(intentDraftKey(conversationId));
      if (!raw) return undefined;
      if (raw.slackUserId !== slackUserId) return undefined;
      if (new Date(raw.expiresAt).getTime() <= Date.now()) {
        await client().del(intentDraftKey(conversationId));
        return undefined;
      }
      return raw;
    },

    async set(draft) {
      await client().setex(
        intentDraftKey(draft.conversationId),
        INTENT_DRAFT_TTL_SECONDS,
        JSON.stringify(draft)
      );
    },

    async clear(conversationId, slackUserId) {
      const existing = await this.get(conversationId, slackUserId);
      if (!existing) return;
      await client().del(intentDraftKey(conversationId));
    },
  };
}

/** In-memory draft store for tests only. */
export function createInMemoryIntentDraftStore(): IntentDraftStore {
  const byConv = new Map<string, IntentDraft>();
  return {
    async get(conversationId, slackUserId) {
      const raw = byConv.get(conversationId);
      if (!raw || raw.slackUserId !== slackUserId) return undefined;
      if (new Date(raw.expiresAt).getTime() <= Date.now()) {
        byConv.delete(conversationId);
        return undefined;
      }
      return { ...raw, missingFields: [...raw.missingFields] };
    },
    async set(draft) {
      byConv.set(draft.conversationId, {
        ...draft,
        missingFields: [...draft.missingFields],
      });
    },
    async clear(conversationId, slackUserId) {
      const raw = byConv.get(conversationId);
      if (raw && raw.slackUserId === slackUserId) {
        byConv.delete(conversationId);
      }
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
  // TTL always uses wall clock so test clocks for date resolution do not expire drafts.
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

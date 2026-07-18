import { getRedisClient } from '@/lib/redis';
import { randomUUID } from 'crypto';

export const PENDING_TTL_SECONDS = 10 * 60;
export const CONV_TTL_SECONDS = 30 * 60;

export type PendingWrite = {
  id: string;
  employeeId: string;
  slackUserId: string;
  channelId: string;
  threadTs: string;
  createdAt: number;
  expiresAt: number;
  operation: 'submit_day_timesheet' | 'clear_day_timesheet' | 'create_custom_project';
  payload: {
    date: string;
    entries: Array<{ projectId: string; taskId: string; hours: number }>;
  };
  warnings: string[];
  summaryText: string;
  status: 'pending' | 'executing' | 'completed' | 'cancelled';
  requireKeyword?: string;
};

export type ConversationState = {
  threadKey: string;
  employeeId: string;
  slackUserId: string;
  context: {
    lastDate?: string;
    lastWeekStart?: string;
    lastProjectId?: string;
    lastProjectLabel?: string;
    lastTaskId?: string;
    lastTaskLabel?: string;
    lastClient?: string;
  };
  draft?: {
    date?: string;
    projectQuery?: string;
    projectId?: string;
    projectCreateName?: string;
    taskQuery?: string;
    taskId?: string;
    hours?: number;
    intent?: string;
  };
  pendingWriteId?: string;
  flags?: {
    awaitDisambiguation?: 'project' | 'task' | 'merge_policy' | 'keyword';
    candidates?: Array<{ id: string; label: string }>;
    mergePolicyEntry?: { projectId: string; taskId: string; hours: number };
    leaveOverride?: boolean;
    holidayAcknowledged?: boolean;
    futureAcknowledged?: boolean;
    over24Acknowledged?: boolean;
    createCustomProject?: boolean;
  };
  updatedAt: number;
};

function convKey(threadKey: string) {
  return `timesheet-agent:conv:${threadKey}`;
}

function pendingKey(id: string) {
  return `timesheet-agent:pending:${id}`;
}

function threadPendingKey(threadKey: string) {
  return `timesheet-agent:thread-pending:${threadKey}`;
}

export function makeThreadKey(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

export async function loadConversation(
  threadKey: string
): Promise<ConversationState | null> {
  const redis = getRedisClient();
  return redis.get<ConversationState>(convKey(threadKey));
}

export async function saveConversation(state: ConversationState): Promise<void> {
  const redis = getRedisClient();
  state.updatedAt = Date.now();
  await redis.setex(convKey(state.threadKey), CONV_TTL_SECONDS, JSON.stringify(state));
}

export async function clearPendingFromConversation(
  state: ConversationState
): Promise<ConversationState> {
  if (state.pendingWriteId) {
    try {
      const redis = getRedisClient();
      await redis.del(pendingKey(state.pendingWriteId));
      await redis.del(threadPendingKey(state.threadKey));
    } catch {
      // ignore
    }
  }
  return { ...state, pendingWriteId: undefined, draft: undefined };
}

export async function createPendingWrite(
  input: Omit<PendingWrite, 'id' | 'createdAt' | 'expiresAt' | 'status'>
): Promise<PendingWrite> {
  const redis = getRedisClient();
  const id = randomUUID();
  const now = Date.now();
  const pending: PendingWrite = {
    ...input,
    id,
    createdAt: now,
    expiresAt: now + PENDING_TTL_SECONDS * 1000,
    status: 'pending',
  };

  const tKey = makeThreadKey(input.channelId, input.threadTs);
  const oldId = await redis.get<string>(threadPendingKey(tKey));
  if (oldId) {
    await redis.del(pendingKey(oldId));
  }

  await redis.setex(pendingKey(id), PENDING_TTL_SECONDS, JSON.stringify(pending));
  await redis.setex(threadPendingKey(tKey), PENDING_TTL_SECONDS, id);
  return pending;
}

export async function getPendingWrite(id: string): Promise<PendingWrite | null> {
  const redis = getRedisClient();
  const p = await redis.get<PendingWrite>(pendingKey(id));
  if (!p) return null;
  if (p.expiresAt < Date.now() || p.status === 'cancelled' || p.status === 'completed') {
    return null;
  }
  return p;
}

/**
 * Atomically mark pending as executing. Returns null if already executing/done/missing.
 */
export async function claimPendingWrite(
  id: string,
  slackUserId: string
): Promise<PendingWrite | null> {
  const redis = getRedisClient();
  const p = await redis.get<PendingWrite>(pendingKey(id));
  if (!p || p.status !== 'pending' || p.expiresAt < Date.now()) {
    return null;
  }
  if (p.slackUserId !== slackUserId) {
    throw new Error('WRONG_USER');
  }
  p.status = 'executing';
  await redis.setex(pendingKey(id), PENDING_TTL_SECONDS, JSON.stringify(p));
  return p;
}

export async function completePendingWrite(id: string, status: 'completed' | 'cancelled') {
  const redis = getRedisClient();
  const p = await redis.get<PendingWrite>(pendingKey(id));
  if (!p) return;
  p.status = status;
  await redis.setex(pendingKey(id), 60, JSON.stringify(p));
  await redis.del(threadPendingKey(makeThreadKey(p.channelId, p.threadTs)));
}

export async function wasEventProcessed(eventId: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = `timesheet-agent:event:${eventId}`;
  const set = await redis.setNx(key, '1', 60 * 60 * 24);
  return !set; // if not set, already existed
}

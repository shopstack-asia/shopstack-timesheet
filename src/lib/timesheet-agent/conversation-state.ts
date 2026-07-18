import { getRedisClient, type RedisAdapter } from '@/lib/redis';
import { randomUUID } from 'crypto';
import { DayEntry } from '@/lib/timesheet-agent/merge';
import { dayFingerprint } from '@/lib/timesheet-agent/verify';

export const PENDING_TTL_SECONDS = 10 * 60;
export const CONV_TTL_SECONDS = 30 * 60;
export const CLAIM_TTL_SECONDS = 120;

export type PendingOperationType = 'add' | 'update' | 'delete' | 'clear';

export type PendingWrite = {
  id: string;
  employeeId: string;
  slackUserId: string;
  channelId: string;
  threadTs: string;
  createdAt: number;
  expiresAt: number;
  operation: 'submit_day_timesheet' | 'clear_day_timesheet';
  operationType: PendingOperationType;
  /** Project|Task key for add/update/delete corrections */
  targetEntryKey?: string;
  targetEntry?: DayEntry;
  /** Day entries before applying the intended operation */
  baseSnapshot: DayEntry[];
  baseFingerprint: string;
  payload: {
    date: string;
    entries: DayEntry[];
  };
  warnings: string[];
  summaryText: string;
  status: 'pending' | 'executing' | 'completed' | 'cancelled';
  requireKeyword?: 'YES' | 'CLEAR';
  /**
   * Policy codes presented to the user for this pending write.
   * YES only acknowledges these codes (plus leaveOverride if set via OVERRIDE).
   */
  presentedPolicyCodes?: import('@/lib/timesheet-agent/guardrails').PolicyCode[];
  /** Acknowledgments already obtained before pending (e.g. leave OVERRIDE) */
  policyAcks?: {
    leaveOverride?: boolean;
    holidayAcknowledged?: boolean;
    futureAcknowledged?: boolean;
    over24Acknowledged?: boolean;
  };
  /** Fingerprint of payload.entries at pending creation */
  payloadFingerprint?: string;
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
    taskQuery?: string;
    taskId?: string;
    hours?: number;
    intent?: string;
  };
  pendingWriteId?: string;
  /** Awaiting OVERRIDE before creating YES pending */
  awaitingLeaveOverride?: boolean;
  flags?: {
    awaitDisambiguation?: 'project' | 'task' | 'merge_policy' | 'correction_target';
    candidates?: Array<{ id: string; label: string }>;
    mergePolicyEntry?: DayEntry;
    leaveOverride?: boolean;
    holidayAcknowledged?: boolean;
    futureAcknowledged?: boolean;
    over24Acknowledged?: boolean;
  };
  updatedAt: number;
};

function convKey(threadKey: string) {
  return `timesheet-agent:conv:${threadKey}`;
}

export function pendingKey(id: string) {
  return `timesheet-agent:pending:${id}`;
}

function pendingClaimKey(id: string) {
  return `timesheet-agent:pending-claim:${id}`;
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
      await redis.del(pendingClaimKey(state.pendingWriteId));
      await redis.del(threadPendingKey(state.threadKey));
    } catch {
      // ignore
    }
  }
  return {
    ...state,
    pendingWriteId: undefined,
    awaitingLeaveOverride: false,
  };
}

export type CreatePendingInput = Omit<
  PendingWrite,
  'id' | 'createdAt' | 'expiresAt' | 'status' | 'baseFingerprint'
> & { baseSnapshot: DayEntry[] };

export async function createPendingWrite(
  input: CreatePendingInput
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
    baseFingerprint: dayFingerprint(input.baseSnapshot),
    payloadFingerprint:
      input.payloadFingerprint ?? dayFingerprint(input.payload.entries),
  };

  const tKey = makeThreadKey(input.channelId, input.threadTs);
  const oldId = await redis.get<string>(threadPendingKey(tKey));
  if (oldId) {
    await redis.del(pendingKey(oldId));
    await redis.del(pendingClaimKey(oldId));
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
 * Atomic claim: SET NX claim lock, then transition to executing.
 * Concurrent claims: only one succeeds.
 *
 * Crash recovery: if status is already `executing` but the claim lock expired
 * (previous worker died), acquiring NX means we may safely reclaim.
 */
export async function claimPendingWrite(
  id: string,
  slackUserId: string,
  deps?: { redis?: Pick<RedisAdapter, 'get' | 'setNx' | 'setex' | 'del'> }
): Promise<PendingWrite | null> {
  const redis = deps?.redis ?? getRedisClient();
  const claimKey = pendingClaimKey(id);

  const acquired = await redis.setNx(claimKey, slackUserId, CLAIM_TTL_SECONDS);
  if (!acquired) {
    return null;
  }

  try {
    const p = await redis.get<PendingWrite>(pendingKey(id));
    if (!p || p.expiresAt < Date.now()) {
      await redis.del(claimKey);
      return null;
    }
    if (p.status === 'completed' || p.status === 'cancelled') {
      await redis.del(claimKey);
      return null;
    }
    // pending = normal; executing + acquired NX = orphaned after crash/claim TTL
    if (p.status !== 'pending' && p.status !== 'executing') {
      await redis.del(claimKey);
      return null;
    }
    if (p.slackUserId !== slackUserId) {
      await redis.del(claimKey);
      throw new Error('WRONG_USER');
    }

    const executing: PendingWrite = { ...p, status: 'executing' };
    await redis.setex(
      pendingKey(id),
      PENDING_TTL_SECONDS,
      JSON.stringify(executing)
    );
    return executing;
  } catch (error) {
    if (error instanceof Error && error.message === 'WRONG_USER') {
      throw error;
    }
    try {
      await redis.del(claimKey);
    } catch {
      // ignore
    }
    throw error;
  }
}

export async function completePendingWrite(
  id: string,
  status: 'completed' | 'cancelled'
) {
  const redis = getRedisClient();
  const p = await redis.get<PendingWrite>(pendingKey(id));
  if (!p) {
    await redis.del(pendingClaimKey(id));
    return;
  }
  p.status = status;
  await redis.setex(pendingKey(id), 60, JSON.stringify(p));
  await redis.del(pendingClaimKey(id));
  await redis.del(threadPendingKey(makeThreadKey(p.channelId, p.threadTs)));
}

export async function releaseClaim(id: string): Promise<void> {
  const redis = getRedisClient();
  await redis.del(pendingClaimKey(id));
}

/** @returns true if this event_id was already processed */
export async function wasEventProcessed(eventId: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = `timesheet-agent:event:${eventId}`;
  const set = await redis.setNx(key, '1', 60 * 60 * 24);
  return !set;
}

export function fingerprintFromEntries(
  entries: Array<{ projectId: string; taskId: string; hours: number }>
): string {
  return dayFingerprint(entries);
}

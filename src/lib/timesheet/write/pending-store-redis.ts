import { getRedisClient, type RedisAdapter } from '@/lib/redis';
import {
  COMPLETED_RETENTION_SECONDS,
  PENDING_CHANGE_TTL_SECONDS,
  type PendingTimesheetChange,
} from '@/lib/timesheet/write/pending-types';
import {
  PendingStoreError,
  type CreatePendingInput,
  type FenceTransitionResult,
  type PendingTimesheetChangeStore,
} from '@/lib/timesheet/write/pending-store-types';
import {
  buildPendingFromCreateInput,
  clonePending,
  deserializePending,
  serializePending,
  type SerializedPendingChange,
} from '@/lib/timesheet/write/pending-serialize';

export const PENDING_CHANGE_KEY_PREFIX = 'timesheet:pending-change:';
export const PENDING_CONV_KEY_PREFIX = 'timesheet:pending-by-conv:';

export function pendingChangeKey(confirmationId: string): string {
  return `${PENDING_CHANGE_KEY_PREFIX}${confirmationId}`;
}

export function pendingConversationKey(conversationId: string): string {
  return `${PENDING_CONV_KEY_PREFIX}${conversationId}`;
}

type RedisPending = Pick<
  RedisAdapter,
  'get' | 'setex' | 'setNx' | 'del' | 'expire' | 'evalScript'
>;

const LUA_CREATE = `
local exists = redis.call('EXISTS', KEYS[1])
if exists == 1 then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
redis.call('SADD', KEYS[2], ARGV[3])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[2]))
return 1
`;

/**
 * Atomic claim pending → executing; bump executionVersion.
 * ARGV[1]=nowMs, ARGV[2]=ttlSeconds, ARGV[3]=claimedAtIso
 */
const LUA_CLAIM = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return cjson.encode({ok=false, status='missing'})
end
local change = cjson.decode(raw)
local nowMs = tonumber(ARGV[1])
local expiresAtMs = tonumber(change.expiresAtMs) or 0
if change.status == 'pending' and expiresAtMs > 0 and nowMs >= expiresAtMs then
  change.status = 'expired'
  redis.call('SET', KEYS[1], cjson.encode(change), 'EX', tonumber(ARGV[2]))
  return cjson.encode({ok=false, status='expired'})
end
if change.status ~= 'pending' then
  return cjson.encode({ok=false, status=change.status})
end
local prev = tonumber(change.executionVersion) or 0
change.status = 'executing'
change.claimedAt = ARGV[3]
change.claimedAtMs = nowMs
change.executionVersion = prev + 1
redis.call('SET', KEYS[1], cjson.encode(change), 'EX', tonumber(ARGV[2]))
return cjson.encode({ok=true, change=change})
`;

/**
 * Reclaim stale executing; bump executionVersion (fencing).
 * ARGV[1]=nowMs, ARGV[2]=leaseMs, ARGV[3]=ttlSeconds, ARGV[4]=newClaimedAtIso
 */
const LUA_RECLAIM = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return cjson.encode({ok=false, status='missing'})
end
local change = cjson.decode(raw)
if change.status ~= 'executing' then
  return cjson.encode({ok=false, status=change.status})
end
local claimedAtMs = tonumber(change.claimedAtMs) or 0
local nowMs = tonumber(ARGV[1])
local leaseMs = tonumber(ARGV[2])
if claimedAtMs == 0 or (nowMs - claimedAtMs) < leaseMs then
  return cjson.encode({ok=false, status='executing'})
end
local prev = tonumber(change.executionVersion) or 0
change.claimedAt = ARGV[4]
change.claimedAtMs = nowMs
change.executionVersion = prev + 1
redis.call('SET', KEYS[1], cjson.encode(change), 'EX', tonumber(ARGV[3]))
return cjson.encode({ok=true, change=change})
`;

const LUA_CANCEL = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return cjson.encode({ok=false, status='missing'})
end
local change = cjson.decode(raw)
if change.status ~= 'pending' then
  return cjson.encode({ok=false, status=change.status, change=change})
end
change.status = 'cancelled'
redis.call('SET', KEYS[1], cjson.encode(change), 'EX', tonumber(ARGV[1]))
return cjson.encode({ok=true, change=change})
`;

/**
 * Fenced finalize: status must be executing AND executionVersion must match.
 * ARGV[1]=expectedVersion, ARGV[2]=new JSON body, ARGV[3]=ttlSeconds
 * Returns JSON {ok:true,change:...} | {ok:false,reason=...,status=...,change?...}
 */
const LUA_FENCED_FINALIZE = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return cjson.encode({ok=false, reason='missing'})
end
local change = cjson.decode(raw)
local expected = tonumber(ARGV[1])
local currentVersion = tonumber(change.executionVersion) or 0
if change.status ~= 'executing' then
  return cjson.encode({ok=false, reason='wrong_status', status=change.status, change=change})
end
if currentVersion ~= expected then
  return cjson.encode({ok=false, reason='ownership_lost', status=change.status, change=change})
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
local next = cjson.decode(ARGV[2])
return cjson.encode({ok=true, change=next})
`;

/**
 * Pre-write ownership check.
 * ARGV[1]=expectedVersion → 1 if owning executing claim, else 0
 */
const LUA_ASSERT_OWNERSHIP = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 0
end
local change = cjson.decode(raw)
local expected = tonumber(ARGV[1])
local currentVersion = tonumber(change.executionVersion) or 0
if change.status == 'executing' and currentVersion == expected then
  return 1
end
return 0
`;

type LuaClaimResult =
  | {
      ok: true;
      change: SerializedPendingChange & {
        expiresAtMs?: number;
        claimedAtMs?: number;
      };
    }
  | { ok: false; status: string; change?: SerializedPendingChange };

type LuaFenceResult =
  | {
      ok: true;
      change: SerializedPendingChange & {
        expiresAtMs?: number;
        claimedAtMs?: number;
      };
    }
  | {
      ok: false;
      reason: string;
      status?: string;
      change?: SerializedPendingChange;
    };

function withEpochFields(
  serialized: SerializedPendingChange,
  change: PendingTimesheetChange
): SerializedPendingChange & {
  expiresAtMs: number;
  claimedAtMs?: number;
  executionVersion: number;
} {
  return {
    ...serialized,
    executionVersion: change.executionVersion,
    expiresAtMs: change.expiresAt.getTime(),
    claimedAtMs: change.claimedAt?.getTime(),
  };
}

function parseLuaJson<T>(result: unknown): T {
  if (typeof result === 'string') {
    return JSON.parse(result) as T;
  }
  return result as T;
}

function wrapRedisError(error: unknown): PendingStoreError {
  if (error instanceof PendingStoreError) return error;
  return new PendingStoreError(
    'REDIS_UNAVAILABLE',
    error instanceof Error ? error.message : 'Redis pending store unavailable'
  );
}

function fenceFailFromLua(
  result: Extract<LuaFenceResult, { ok: false }>,
  loaded?: PendingTimesheetChange
): FenceTransitionResult {
  const change = result.change
    ? deserializePending(result.change)
    : loaded;
  if (result.reason === 'missing' && !change) {
    return { ok: false, reason: 'missing' };
  }
  if (result.reason === 'ownership_lost') {
    return { ok: false, reason: 'ownership_lost', change };
  }
  return { ok: false, reason: 'wrong_status', change };
}

/**
 * Production pending store backed by the shared Redis adapter.
 * Fenced execution leases via executionVersion — not read-then-write.
 */
export function createRedisPendingTimesheetChangeStore(
  redis?: RedisPending
): PendingTimesheetChangeStore {
  function client(): RedisPending {
    try {
      return redis ?? getRedisClient();
    } catch (error) {
      throw wrapRedisError(error);
    }
  }

  async function load(
    confirmationId: string
  ): Promise<PendingTimesheetChange | undefined> {
    try {
      const raw = await client().get<
        SerializedPendingChange & { expiresAtMs?: number; claimedAtMs?: number }
      >(pendingChangeKey(confirmationId));
      if (!raw) return undefined;
      const change = deserializePending(raw);
      if (
        change.status === 'pending' &&
        change.expiresAt.getTime() <= Date.now()
      ) {
        return { ...change, status: 'expired' };
      }
      return change;
    } catch (error) {
      throw wrapRedisError(error);
    }
  }

  async function fencedFinalize(
    confirmationId: string,
    executionVersion: number,
    next: PendingTimesheetChange,
    ttlSeconds: number
  ): Promise<FenceTransitionResult> {
    const body = JSON.stringify(withEpochFields(serializePending(next), next));
    try {
      const result = parseLuaJson<LuaFenceResult>(
        await client().evalScript(
          LUA_FENCED_FINALIZE,
          [pendingChangeKey(confirmationId)],
          [executionVersion, body, ttlSeconds]
        )
      );
      if (result.ok) {
        return { ok: true, change: deserializePending(result.change) };
      }
      const reloaded = await load(confirmationId);
      return fenceFailFromLua(result, reloaded);
    } catch (error) {
      throw wrapRedisError(error);
    }
  }

  return {
    async create(input) {
      const change = buildPendingFromCreateInput(input);
      const serialized = withEpochFields(serializePending(change), change);
      const ttlSeconds = Math.ceil(
        (input.ttlMs ?? PENDING_CHANGE_TTL_SECONDS * 1000) / 1000
      );
      try {
        const created = await client().evalScript<number>(
          LUA_CREATE,
          [
            pendingChangeKey(change.confirmationId),
            pendingConversationKey(change.conversationId),
          ],
          [JSON.stringify(serialized), ttlSeconds, change.confirmationId]
        );
        if (created !== 1) {
          throw new PendingStoreError(
            'CREATE_CONFLICT',
            'Confirmation id already exists'
          );
        }
        return clonePending(change);
      } catch (error) {
        if (error instanceof PendingStoreError) throw error;
        throw wrapRedisError(error);
      }
    },

    async get(confirmationId) {
      return load(confirmationId);
    },

    async claimForExecution(confirmationId) {
      const now = new Date();
      try {
        const result = parseLuaJson<LuaClaimResult>(
          await client().evalScript(
            LUA_CLAIM,
            [pendingChangeKey(confirmationId)],
            [now.getTime(), PENDING_CHANGE_TTL_SECONDS, now.toISOString()]
          )
        );
        if (!result.ok) return null;
        return clonePending(deserializePending(result.change));
      } catch (error) {
        throw wrapRedisError(error);
      }
    },

    async reclaimStaleExecution(confirmationId, leaseMs) {
      const now = new Date();
      try {
        const result = parseLuaJson<LuaClaimResult>(
          await client().evalScript(
            LUA_RECLAIM,
            [pendingChangeKey(confirmationId)],
            [
              now.getTime(),
              leaseMs,
              PENDING_CHANGE_TTL_SECONDS,
              now.toISOString(),
            ]
          )
        );
        if (!result.ok) return null;
        return clonePending(deserializePending(result.change));
      } catch (error) {
        throw wrapRedisError(error);
      }
    },

    async assertExecutionOwnership(confirmationId, executionVersion) {
      try {
        const ok = await client().evalScript<number>(
          LUA_ASSERT_OWNERSHIP,
          [pendingChangeKey(confirmationId)],
          [executionVersion]
        );
        return ok === 1;
      } catch (error) {
        throw wrapRedisError(error);
      }
    },

    async markCompleted(confirmationId, executionVersion, result) {
      const current = await load(confirmationId);
      if (!current) return { ok: false, reason: 'missing' };
      if (current.status !== 'executing') {
        return { ok: false, reason: 'wrong_status', change: current };
      }
      if (current.executionVersion !== executionVersion) {
        return { ok: false, reason: 'ownership_lost', change: current };
      }
      const next: PendingTimesheetChange = {
        ...current,
        status: 'completed',
        completedAt: new Date(),
        resultSnapshotHash: result.resultSnapshotHash,
        completedResult: result.completedResult,
      };
      return fencedFinalize(
        confirmationId,
        executionVersion,
        next,
        result.retentionSeconds ?? COMPLETED_RETENTION_SECONDS
      );
    },

    async markCancelled(confirmationId) {
      try {
        const result = parseLuaJson<LuaClaimResult>(
          await client().evalScript(
            LUA_CANCEL,
            [pendingChangeKey(confirmationId)],
            [PENDING_CHANGE_TTL_SECONDS]
          )
        );
        if (result.ok) {
          return clonePending({
            ...deserializePending(result.change),
            status: 'cancelled',
          });
        }
        if (result.change) {
          return deserializePending(result.change);
        }
        return undefined;
      } catch (error) {
        throw wrapRedisError(error);
      }
    },

    async markConflict(confirmationId, executionVersion) {
      const current = await load(confirmationId);
      if (!current) return { ok: false, reason: 'missing' };
      if (current.status !== 'executing') {
        return { ok: false, reason: 'wrong_status', change: current };
      }
      if (current.executionVersion !== executionVersion) {
        return { ok: false, reason: 'ownership_lost', change: current };
      }
      const next: PendingTimesheetChange = { ...current, status: 'conflict' };
      return fencedFinalize(
        confirmationId,
        executionVersion,
        next,
        PENDING_CHANGE_TTL_SECONDS
      );
    },

    async markFailed(confirmationId, executionVersion, safeError) {
      const current = await load(confirmationId);
      if (!current) return { ok: false, reason: 'missing' };
      if (current.status !== 'executing') {
        return { ok: false, reason: 'wrong_status', change: current };
      }
      if (current.executionVersion !== executionVersion) {
        return { ok: false, reason: 'ownership_lost', change: current };
      }
      const next: PendingTimesheetChange = {
        ...current,
        status: 'failed',
        safeError,
      };
      return fencedFinalize(
        confirmationId,
        executionVersion,
        next,
        PENDING_CHANGE_TTL_SECONDS
      );
    },

    async findPendingByConversation(conversationId) {
      try {
        const ids = await client().evalScript<string[]>(
          `return redis.call('SMEMBERS', KEYS[1])`,
          [pendingConversationKey(conversationId)],
          []
        );
        const list = Array.isArray(ids) ? ids : [];
        const out: PendingTimesheetChange[] = [];
        for (const id of list) {
          const change = await load(String(id));
          if (
            change &&
            change.conversationId === conversationId &&
            change.status === 'pending' &&
            change.expiresAt.getTime() > Date.now()
          ) {
            out.push(clonePending(change));
          }
        }
        return out;
      } catch (error) {
        throw wrapRedisError(error);
      }
    },
  };
}

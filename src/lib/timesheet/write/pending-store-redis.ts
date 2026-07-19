import { getRedisClient, type RedisAdapter } from '@/lib/redis';
import {
  COMPLETED_RETENTION_SECONDS,
  PENDING_CHANGE_TTL_SECONDS,
  type PendingTimesheetChange,
} from '@/lib/timesheet/write/pending-types';
import {
  PendingStoreError,
  type CreatePendingInput,
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

/**
 * Atomic create: SET NX + SADD conversation index + EXPIRE.
 * Returns 1 if created, 0 if confirmationId already exists.
 */
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
 * Atomic claim pending → executing.
 * ARGV[1]=nowMs, ARGV[2]=ttlSeconds, ARGV[3]=claimedAtIso
 * Returns JSON: {ok:true,change:...} | {ok:false,status:...}
 */
const LUA_CLAIM = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return cjson.encode({ok=false, status='missing'})
end
local change = cjson.decode(raw)
local nowMs = tonumber(ARGV[1])
local expiresAtMs = 0
if type(change.expiresAt) == 'string' then
  -- ISO date: approximate via stored expiresAtMs if present, else parse not available
  expiresAtMs = tonumber(change.expiresAtMs) or 0
end
if change.expiresAtMs then
  expiresAtMs = tonumber(change.expiresAtMs)
end
if change.status == 'pending' and expiresAtMs > 0 and nowMs >= expiresAtMs then
  change.status = 'expired'
  redis.call('SET', KEYS[1], cjson.encode(change), 'EX', tonumber(ARGV[2]))
  return cjson.encode({ok=false, status='expired'})
end
if change.status ~= 'pending' then
  return cjson.encode({ok=false, status=change.status})
end
change.status = 'executing'
change.claimedAt = ARGV[3]
redis.call('SET', KEYS[1], cjson.encode(change), 'EX', tonumber(ARGV[2]))
return cjson.encode({ok=true, change=change})
`;

/**
 * Reclaim stale executing when claimedAtMs + leaseMs < nowMs.
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
change.claimedAt = ARGV[4]
change.claimedAtMs = nowMs
redis.call('SET', KEYS[1], cjson.encode(change), 'EX', tonumber(ARGV[3]))
return cjson.encode({ok=true, change=change})
`;

/**
 * Atomic cancel: pending → cancelled only.
 */
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
 * CAS status update when current status is in allowed list (ARGV[1] JSON array).
 * ARGV[2]=new JSON body, ARGV[3]=ttlSeconds
 */
const LUA_CAS_STATUS = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 0
end
local change = cjson.decode(raw)
local allowed = cjson.decode(ARGV[1])
local ok = false
for _, s in ipairs(allowed) do
  if change.status == s then
    ok = true
    break
  end
end
if not ok then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
return 1
`;

type LuaClaimResult =
  | { ok: true; change: SerializedPendingChange & { expiresAtMs?: number; claimedAtMs?: number } }
  | { ok: false; status: string; change?: SerializedPendingChange };

function withEpochFields(
  serialized: SerializedPendingChange,
  change: PendingTimesheetChange
): SerializedPendingChange & { expiresAtMs: number; claimedAtMs?: number } {
  return {
    ...serialized,
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

/**
 * Production pending store backed by the shared Redis adapter.
 * Uses Lua for create / claim / cancel / CAS — not read-then-write.
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
            [
              now.getTime(),
              PENDING_CHANGE_TTL_SECONDS,
              now.toISOString(),
            ]
          )
        );
        if (!result.ok) return null;
        const change = deserializePending(result.change);
        return clonePending({
          ...change,
          status: 'executing',
          claimedAt: now,
        });
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
        return clonePending({
          ...deserializePending(result.change),
          status: 'executing',
          claimedAt: now,
        });
      } catch (error) {
        throw wrapRedisError(error);
      }
    },

    async markCompleted(confirmationId, result) {
      const current = await load(confirmationId);
      if (!current) return undefined;
      if (current.status !== 'executing' && current.status !== 'pending') {
        return clonePending(current);
      }
      const next: PendingTimesheetChange = {
        ...current,
        status: 'completed',
        completedAt: new Date(),
        resultSnapshotHash: result.resultSnapshotHash,
        completedResult: result.completedResult,
      };
      const retention =
        result.retentionSeconds ?? COMPLETED_RETENTION_SECONDS;
      const body = JSON.stringify(withEpochFields(serializePending(next), next));
      try {
        const ok = await client().evalScript<number>(
          LUA_CAS_STATUS,
          [pendingChangeKey(confirmationId)],
          [
            JSON.stringify(['executing', 'pending']),
            body,
            retention,
          ]
        );
        if (ok !== 1) {
          return load(confirmationId);
        }
        return clonePending(next);
      } catch (error) {
        throw wrapRedisError(error);
      }
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

    async markConflict(confirmationId) {
      const current = await load(confirmationId);
      if (!current) return undefined;
      const next: PendingTimesheetChange = { ...current, status: 'conflict' };
      const body = JSON.stringify(withEpochFields(serializePending(next), next));
      try {
        await client().evalScript<number>(
          LUA_CAS_STATUS,
          [pendingChangeKey(confirmationId)],
          [
            JSON.stringify(['executing', 'pending']),
            body,
            PENDING_CHANGE_TTL_SECONDS,
          ]
        );
        return clonePending(next);
      } catch (error) {
        throw wrapRedisError(error);
      }
    },

    async markFailed(confirmationId, safeError) {
      const current = await load(confirmationId);
      if (!current) return undefined;
      const next: PendingTimesheetChange = {
        ...current,
        status: 'failed',
        safeError,
      };
      const body = JSON.stringify(withEpochFields(serializePending(next), next));
      try {
        await client().evalScript<number>(
          LUA_CAS_STATUS,
          [pendingChangeKey(confirmationId)],
          [
            JSON.stringify(['executing', 'pending']),
            body,
            PENDING_CHANGE_TTL_SECONDS,
          ]
        );
        return clonePending(next);
      } catch (error) {
        throw wrapRedisError(error);
      }
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

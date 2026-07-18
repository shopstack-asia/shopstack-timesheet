import { randomUUID } from 'crypto';
import { getRedisClient, type RedisAdapter } from '@/lib/redis';

export const TIME_LOG_WRITE_LOCK_KEY = 'timesheet:sheets:timelog:write';

export const DEFAULT_LOCK_TTL_SECONDS = 90;
export const DEFAULT_WAIT_TIMEOUT_MS = 45_000;
export const DEFAULT_RETRY_DELAY_MS = 200;

export class SheetsWriteLockError extends Error {
  readonly code: 'LOCK_TIMEOUT' | 'REDIS_UNAVAILABLE';

  constructor(code: 'LOCK_TIMEOUT' | 'REDIS_UNAVAILABLE', message: string) {
    super(message);
    this.name = 'SheetsWriteLockError';
    this.code = code;
  }
}

export type SheetsWriteLockDeps = {
  redis?: Pick<RedisAdapter, 'get' | 'setNx' | 'del'>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  waitTimeoutMs?: number;
  lockTtlSeconds?: number;
  retryDelayMs?: number;
  createToken?: () => string;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Serialize Time Log sheet mutations across serverless instances.
 * Acquires a Redis NX lock, runs fn, then releases only if still holding the token.
 */
export async function withTimeLogWriteLock<T>(
  fn: () => Promise<T>,
  deps: SheetsWriteLockDeps = {}
): Promise<T> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const waitTimeoutMs = deps.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const lockTtlSeconds = deps.lockTtlSeconds ?? DEFAULT_LOCK_TTL_SECONDS;
  const retryDelayMs = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const createToken = deps.createToken ?? (() => randomUUID());

  let redis: Pick<RedisAdapter, 'get' | 'setNx' | 'del'>;
  try {
    redis = deps.redis ?? getRedisClient();
  } catch (error) {
    throw new SheetsWriteLockError(
      'REDIS_UNAVAILABLE',
      error instanceof Error ? error.message : 'Redis is unavailable'
    );
  }

  const token = createToken();
  const deadline = now() + waitTimeoutMs;
  let acquired = false;

  try {
    while (now() < deadline) {
      try {
        acquired = await redis.setNx(TIME_LOG_WRITE_LOCK_KEY, token, lockTtlSeconds);
      } catch (error) {
        throw new SheetsWriteLockError(
          'REDIS_UNAVAILABLE',
          error instanceof Error ? error.message : 'Redis lock acquire failed'
        );
      }

      if (acquired) {
        break;
      }

      await sleep(retryDelayMs);
    }

    if (!acquired) {
      throw new SheetsWriteLockError(
        'LOCK_TIMEOUT',
        'Timed out waiting for timesheet write lock'
      );
    }

    return await fn();
  } finally {
    if (acquired) {
      try {
        const current = await redis.get<string>(TIME_LOG_WRITE_LOCK_KEY);
        if (current === token) {
          await redis.del(TIME_LOG_WRITE_LOCK_KEY);
        }
      } catch {
        // Best-effort release; TTL will expire the lock
      }
    }
  }
}

import { describe, it, expect, vi } from 'vitest';
import {
  SheetsWriteLockError,
  TIME_LOG_WRITE_LOCK_KEY,
  withTimeLogWriteLock,
} from '@/lib/sheets-write-lock';

function createMemoryRedis(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    store,
    async get<T>(key: string): Promise<T | null> {
      const value = store.get(key);
      return (value ?? null) as T | null;
    },
    async setNx(key: string, value: string, _ttlSeconds: number): Promise<boolean> {
      if (store.has(key)) {
        return false;
      }
      store.set(key, value);
      return true;
    },
    async del(key: string): Promise<void> {
      store.delete(key);
    },
  };
}

describe('withTimeLogWriteLock', () => {
  it('acquires lock, runs fn, and releases when token matches', async () => {
    const redis = createMemoryRedis();
    const result = await withTimeLogWriteLock(async () => 'ok', {
      redis,
      createToken: () => 'token-a',
      sleep: async () => undefined,
    });

    expect(result).toBe('ok');
    expect(redis.store.has(TIME_LOG_WRITE_LOCK_KEY)).toBe(false);
  });

  it('waits until lock is available then runs fn', async () => {
    const redis = createMemoryRedis({ [TIME_LOG_WRITE_LOCK_KEY]: 'other' });
    let attempts = 0;
    const originalSetNx = redis.setNx.bind(redis);
    redis.setNx = async (key, value, ttl) => {
      attempts += 1;
      if (attempts === 2) {
        redis.store.delete(TIME_LOG_WRITE_LOCK_KEY);
      }
      return originalSetNx(key, value, ttl);
    };

    const result = await withTimeLogWriteLock(async () => 42, {
      redis,
      createToken: () => 'token-b',
      sleep: async () => undefined,
      now: (() => {
        let t = 0;
        return () => {
          t += 1;
          return t;
        };
      })(),
      waitTimeoutMs: 10,
      retryDelayMs: 0,
    });

    expect(result).toBe(42);
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it('throws LOCK_TIMEOUT without running fn when wait expires', async () => {
    const redis = createMemoryRedis({ [TIME_LOG_WRITE_LOCK_KEY]: 'held' });
    const fn = vi.fn(async () => 'should-not-run');

    await expect(
      withTimeLogWriteLock(fn, {
        redis,
        sleep: async () => undefined,
        now: (() => {
          let calls = 0;
          return () => {
            // First call: deadline = 0 + 5 = 5; loop condition now() < 5
            // Keep returning values that eventually exceed deadline
            calls += 1;
            return calls === 1 ? 0 : 100;
          };
        })(),
        waitTimeoutMs: 5,
        retryDelayMs: 0,
      })
    ).rejects.toMatchObject({
      name: 'SheetsWriteLockError',
      code: 'LOCK_TIMEOUT',
    });

    expect(fn).not.toHaveBeenCalled();
  });

  it('does not delete lock when token no longer matches', async () => {
    const redis = createMemoryRedis();
    await withTimeLogWriteLock(
      async () => {
        // Simulate TTL expiry + another holder taking the lock
        redis.store.set(TIME_LOG_WRITE_LOCK_KEY, 'someone-else');
        return true;
      },
      {
        redis,
        createToken: () => 'my-token',
        sleep: async () => undefined,
      }
    );

    expect(redis.store.get(TIME_LOG_WRITE_LOCK_KEY)).toBe('someone-else');
  });

  it('propagates REDIS_UNAVAILABLE when setNx throws', async () => {
    const redis = {
      async get() {
        return null;
      },
      async setNx() {
        throw new Error('redis down');
      },
      async del() {
        return;
      },
    };

    await expect(
      withTimeLogWriteLock(async () => null, {
        redis,
        sleep: async () => undefined,
        now: () => 0,
        waitTimeoutMs: 1000,
      })
    ).rejects.toBeInstanceOf(SheetsWriteLockError);

    await expect(
      withTimeLogWriteLock(async () => null, {
        redis,
        sleep: async () => undefined,
        now: () => 0,
        waitTimeoutMs: 1000,
      })
    ).rejects.toMatchObject({ code: 'REDIS_UNAVAILABLE' });
  });
});

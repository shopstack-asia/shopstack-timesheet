import { describe, expect, it, vi } from 'vitest';
import {
  bumpCounterAtomic,
  enforceRateLimit,
  RATE_LIMIT_INCR_EXPIRE_SCRIPT,
} from '@/lib/rate-limit';
import { NextRequest } from 'next/server';

/**
 * In-memory Redis stand-in that executes the rate-limit Lua semantics in one
 * synchronous step (mirrors atomic EVAL: INCR + conditional EXPIRE).
 */
function memoryRedis(options?: { evalFails?: boolean }) {
  const store = new Map<string, { value: number; expiresAt?: number }>();
  let expireCalls = 0;

  return {
    store,
    getExpireCalls: () => expireCalls,
    async evalScript<T = unknown>(
      script: string,
      keys: string[],
      args: (string | number)[]
    ): Promise<T> {
      if (options?.evalFails) {
        throw new Error('Lua EVAL failed');
      }
      expect(script).toBe(RATE_LIMIT_INCR_EXPIRE_SCRIPT);
      const key = keys[0]!;
      const windowSeconds = Number(args[0]);
      const cur = store.get(key);
      const next = (cur?.value || 0) + 1;
      const ttlMissing = cur?.expiresAt == null;
      const entry: { value: number; expiresAt?: number } = {
        value: next,
        expiresAt: cur?.expiresAt,
      };
      // Same as Lua: EXPIRE when first create (count==1) or PTTL < 0 (no TTL)
      if (next === 1 || ttlMissing) {
        entry.expiresAt = Date.now() + windowSeconds * 1000;
        expireCalls += 1;
      }
      store.set(key, entry);
      return next as T;
    },
  };
}

describe('atomic rate limit (Lua EVAL)', () => {
  it('allows first request and applies TTL', async () => {
    const redis = memoryRedis();
    expect(await bumpCounterAtomic(redis, 'k', 3, 60)).toBe(true);
    expect(redis.store.get('k')?.value).toBe(1);
    expect(redis.store.get('k')?.expiresAt).toBeTypeOf('number');
    expect(redis.getExpireCalls()).toBe(1);
  });

  it('allows request at limit', async () => {
    const redis = memoryRedis();
    expect(await bumpCounterAtomic(redis, 'k', 2, 60)).toBe(true);
    expect(await bumpCounterAtomic(redis, 'k', 2, 60)).toBe(true);
  });

  it('rejects when limit reached', async () => {
    const redis = memoryRedis();
    await bumpCounterAtomic(redis, 'k', 2, 60);
    await bumpCounterAtomic(redis, 'k', 2, 60);
    expect(await bumpCounterAtomic(redis, 'k', 2, 60)).toBe(false);
  });

  it('concurrent requests do not exceed limit', async () => {
    const redis = memoryRedis();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => bumpCounterAtomic(redis, 'concurrent', 5, 60))
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(redis.store.get('concurrent')?.value).toBe(20);
    expect(redis.store.get('concurrent')?.expiresAt).toBeTypeOf('number');
  });

  it('applies TTL only once while key already has expiry', async () => {
    const redis = memoryRedis();
    await bumpCounterAtomic(redis, 'ttl', 10, 30);
    const firstExpiry = redis.store.get('ttl')?.expiresAt;
    await bumpCounterAtomic(redis, 'ttl', 10, 30);
    expect(redis.getExpireCalls()).toBe(1);
    expect(redis.store.get('ttl')?.expiresAt).toBe(firstExpiry);
  });

  it('heals missing TTL after simulated Redis restart / crash between INCR and EXPIRE', async () => {
    const redis = memoryRedis();
    // Simulate legacy non-atomic path: INCR succeeded, EXPIRE never ran
    redis.store.set('orphan', { value: 4 });
    expect(redis.store.get('orphan')?.expiresAt).toBeUndefined();

    expect(await bumpCounterAtomic(redis, 'orphan', 10, 45)).toBe(true);
    expect(redis.store.get('orphan')?.value).toBe(5);
    expect(redis.store.get('orphan')?.expiresAt).toBeTypeOf('number');
    expect(redis.getExpireCalls()).toBe(1);
  });

  it('fail-closes with 503 when Lua EVAL fails (default failOpen=false)', async () => {
    const redis = memoryRedis({ evalFails: true });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = new NextRequest('http://localhost/api/x', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    const result = await enforceRateLimit(
      req,
      { bucket: 't', limit: 1, windowSeconds: 60 },
      { redis }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
    }
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('fail-opens when failOpen=true and Redis unavailable', async () => {
    const redis = memoryRedis({ evalFails: true });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = new NextRequest('http://localhost/api/x', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    const result = await enforceRateLimit(
      req,
      { bucket: 't', limit: 1, windowSeconds: 60, failOpen: true },
      { redis }
    );
    expect(result.ok).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('fail-closes when failOpen=false explicitly', async () => {
    const redis = memoryRedis({ evalFails: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = new NextRequest('http://localhost/api/x');
    const result = await enforceRateLimit(
      req,
      { bucket: 't', limit: 1, windowSeconds: 60, failOpen: false },
      { redis }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
    }
  });

  it('separate IP and user buckets', async () => {
    const redis = memoryRedis();
    const req = new NextRequest('http://localhost/api/x', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    const a = await enforceRateLimit(
      req,
      { bucket: 't', limit: 1, windowSeconds: 60, userKey: 'U1' },
      { redis }
    );
    expect(a.ok).toBe(true);
    const b = await enforceRateLimit(
      req,
      { bucket: 't', limit: 1, windowSeconds: 60, userKey: 'U1' },
      { redis }
    );
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.response.status).toBe(429);
      expect(b.response.headers.get('Retry-After')).toBe('60');
    }

    const redis2 = memoryRedis();
    const r1 = await enforceRateLimit(
      new NextRequest('http://localhost/api/x', {
        headers: { 'x-forwarded-for': '9.9.9.9' },
      }),
      { bucket: 't2', limit: 2, windowSeconds: 60, userKey: 'A' },
      { redis: redis2 }
    );
    const r2 = await enforceRateLimit(
      new NextRequest('http://localhost/api/x', {
        headers: { 'x-forwarded-for': '8.8.8.8' },
      }),
      { bucket: 't2', limit: 2, windowSeconds: 60, userKey: 'B' },
      { redis: redis2 }
    );
    expect(r1.ok && r2.ok).toBe(true);
    expect(redis2.store.has('ratelimit:t2:ip:9.9.9.9')).toBe(true);
    expect(redis2.store.has('ratelimit:t2:user:A')).toBe(true);
    expect(redis2.store.has('ratelimit:t2:ip:8.8.8.8')).toBe(true);
    expect(redis2.store.has('ratelimit:t2:user:B')).toBe(true);
  });
});

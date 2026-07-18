import { describe, expect, it, vi } from 'vitest';
import { bumpCounterAtomic, enforceRateLimit } from '@/lib/rate-limit';
import { NextRequest } from 'next/server';

function memoryRedis() {
  const store = new Map<string, { value: number; expiresAt?: number }>();
  return {
    async incr(key: string) {
      const cur = store.get(key);
      const next = (cur?.value || 0) + 1;
      store.set(key, { value: next, expiresAt: cur?.expiresAt });
      return next;
    },
    async expire(key: string, seconds: number) {
      const cur = store.get(key) || { value: 0 };
      store.set(key, { ...cur, expiresAt: Date.now() + seconds * 1000 });
    },
    store,
  };
}

describe('atomic rate limit', () => {
  it('allows first request', async () => {
    const redis = memoryRedis();
    expect(await bumpCounterAtomic(redis, 'k', 3, 60)).toBe(true);
    expect(redis.store.get('k')?.value).toBe(1);
    expect(redis.store.get('k')?.expiresAt).toBeTypeOf('number');
  });

  it('allows request at limit', async () => {
    const redis = memoryRedis();
    expect(await bumpCounterAtomic(redis, 'k', 2, 60)).toBe(true);
    expect(await bumpCounterAtomic(redis, 'k', 2, 60)).toBe(true);
  });

  it('rejects above limit', async () => {
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
  });

  it('sets expiration only on first incr', async () => {
    const redis = memoryRedis();
    const expire = vi.spyOn(redis, 'expire');
    await bumpCounterAtomic(redis, 'ttl', 10, 30);
    await bumpCounterAtomic(redis, 'ttl', 10, 30);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledWith('ttl', 30);
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
    // Different user still hits same IP bucket first — IP already at 2? 
    // After 2 calls IP count is 2 with limit 1, so any further IP fail.
    // Use fresh redis for user isolation demo:
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

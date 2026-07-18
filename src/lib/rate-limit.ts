import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient, type RedisAdapter } from '@/lib/redis';
import { ApiResponse } from '@/types';

export type RateLimitResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

export type RateLimitOptions = {
  /** Logical bucket, e.g. timesheet-submit */
  bucket: string;
  /** Max requests in the window */
  limit: number;
  /** Window length in seconds */
  windowSeconds: number;
  /** Optional authenticated user/staff key */
  userKey?: string | null;
};

type CounterRedis = Pick<RedisAdapter, 'evalScript'>;

/**
 * Atomic INCR + EXPIRE in one Redis EVAL.
 * Also heals orphan keys that have a counter but no TTL (e.g. crash between
 * legacy separate INCR/EXPIRE calls).
 */
export const RATE_LIMIT_INCR_EXPIRE_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if current == 1 or ttl < 0 then
  redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
end
return current
`.trim();

/**
 * Redis-backed fixed-window rate limit (IP + optional user).
 * Uses a single Lua EVAL so INCR and EXPIRE cannot be separated.
 * Fail-open on Redis errors so availability is preserved; logs the failure.
 */
export async function enforceRateLimit(
  request: NextRequest,
  options: RateLimitOptions,
  deps?: { redis?: CounterRedis }
): Promise<RateLimitResult> {
  const ip = clientIp(request);
  const keys = [
    `ratelimit:${options.bucket}:ip:${ip}`,
    options.userKey
      ? `ratelimit:${options.bucket}:user:${options.userKey}`
      : null,
  ].filter(Boolean) as string[];

  try {
    const redis = deps?.redis ?? getRedisClient();
    for (const key of keys) {
      const allowed = await bumpCounterAtomic(
        redis,
        key,
        options.limit,
        options.windowSeconds
      );
      if (!allowed) {
        return {
          ok: false,
          response: NextResponse.json<ApiResponse<void>>(
            { success: false, error: 'Too many requests. Please try again later.' },
            {
              status: 429,
              headers: { 'Retry-After': String(options.windowSeconds) },
            }
          ),
        };
      }
    }
    return { ok: true };
  } catch (error) {
    console.error('[rate-limit] Redis error — allowing request', error);
    return { ok: true };
  }
}

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Atomic counter via Lua: INCR then EXPIRE when count === 1 (or TTL missing).
 * Returns false when the new count exceeds `limit`.
 */
export async function bumpCounterAtomic(
  redis: CounterRedis,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const n = await redis.evalScript<number>(
    RATE_LIMIT_INCR_EXPIRE_SCRIPT,
    [key],
    [windowSeconds]
  );
  return n <= limit;
}

import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';
import { ApiResponse } from '@/types';

export type RateLimitResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

type RateLimitOptions = {
  /** Logical bucket, e.g. timesheet-submit */
  bucket: string;
  /** Max requests in the window */
  limit: number;
  /** Window length in seconds */
  windowSeconds: number;
  /** Optional authenticated user/staff key */
  userKey?: string | null;
};

/**
 * Redis-backed fixed-window rate limit (IP + optional user).
 * Fail-open on Redis errors so availability is preserved; logs the failure.
 */
export async function enforceRateLimit(
  request: NextRequest,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const ip = clientIp(request);
  const keys = [
    `ratelimit:${options.bucket}:ip:${ip}`,
    options.userKey
      ? `ratelimit:${options.bucket}:user:${options.userKey}`
      : null,
  ].filter(Boolean) as string[];

  try {
    const redis = getRedisClient();
    for (const key of keys) {
      const allowed = await bumpCounter(redis, key, options.limit, options.windowSeconds);
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

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

async function bumpCounter(
  redis: ReturnType<typeof getRedisClient>,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const current = await redis.get<string | number>(key);
  const n =
    typeof current === 'number'
      ? current
      : current != null
        ? Number.parseInt(String(current), 10) || 0
        : 0;

  if (n >= limit) {
    return false;
  }

  await redis.setex(key, windowSeconds, String(n + 1));
  return true;
}

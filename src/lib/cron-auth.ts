import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@/types';

/**
 * Fail-closed cron authentication.
 * Never accepts empty/missing CRON_SECRET or empty Bearer tokens.
 */
export function assertCronAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim() || '';
  if (!secret) {
    console.error(
      '[cron-auth] CRON_SECRET is missing or empty — rejecting request (fail closed)'
    );
    return NextResponse.json<ApiResponse<void>>(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json<ApiResponse<void>>(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return NextResponse.json<ApiResponse<void>>(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  if (!timingSafeEqualString(token, secret)) {
    return NextResponse.json<ApiResponse<void>>(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return null;
}

/** Timing-safe string compare via SHA-256 digests (equal length). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const digA = createHash('sha256').update(a).digest();
  const digB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digA, digB);
}

export function methodNotAllowed(allowed: string[]): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Method not allowed' },
    { status: 405, headers: { Allow: allowed.join(', ') } }
  );
}

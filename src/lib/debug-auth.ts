import { NextRequest, NextResponse } from 'next/server';

/**
 * Debug probes must not be publicly callable in production.
 * Allow when:
 * - Authorization: Bearer ${CRON_SECRET}, or
 * - NODE_ENV !== 'production' (local only)
 */
export function assertDebugAccess(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET || '';
  const auth = request.headers.get('authorization');
  if (secret && auth === `Bearer ${secret}`) {
    return null;
  }
  if (process.env.NODE_ENV !== 'production') {
    return null;
  }
  return NextResponse.json(
    { success: false, error: 'Unauthorized' },
    { status: 401 }
  );
}

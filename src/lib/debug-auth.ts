import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqualString } from '@/lib/cron-auth';

/**
 * Debug probes — fail closed in production unless ENABLE_DEBUG_API=true
 * and Authorization: Bearer ${CRON_SECRET} is valid.
 */
export function assertDebugAccess(request: NextRequest): NextResponse | null {
  const isProd = process.env.NODE_ENV === 'production';
  const enabled =
    process.env.ENABLE_DEBUG_API === 'true' ||
    (!isProd && process.env.ENABLE_DEBUG_API !== 'false');

  if (isProd && process.env.ENABLE_DEBUG_API !== 'true') {
    return NextResponse.json(
      { success: false, error: 'Not found' },
      { status: 404 }
    );
  }

  if (!enabled) {
    return NextResponse.json(
      { success: false, error: 'Not found' },
      { status: 404 }
    );
  }

  const secret = process.env.CRON_SECRET?.trim() || '';
  if (!secret) {
    console.error(
      '[debug-auth] CRON_SECRET missing — debug API rejected (fail closed)'
    );
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const auth = request.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const token = auth.slice('Bearer '.length).trim();
  if (!token || !timingSafeEqualString(token, secret)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return null;
}

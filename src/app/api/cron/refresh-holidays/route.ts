import { NextRequest, NextResponse } from 'next/server';
import { refreshHolidayCache } from '@/lib/holiday-cache';
import { ApiResponse } from '@/types';
import { assertCronAuth } from '@/lib/cron-auth';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

async function runRefresh(request: NextRequest) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const limited = await enforceRateLimit(request, {
    bucket: 'cron-refresh-holidays',
    limit: 10,
    windowSeconds: 60,
  });
  if (!limited.ok) return limited.response;

  try {
    await refreshHolidayCache();
    return NextResponse.json<ApiResponse<void>>({ success: true });
  } catch (error) {
    console.error('Error refreshing holiday cache:', error);
    return NextResponse.json<ApiResponse<void>>(
      { success: false, error: 'Failed to refresh holiday cache' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return runRefresh(request);
}

/**
 * Vercel Cron invokes GET. Side effects require valid CRON_SECRET (fail closed).
 */
export async function GET(request: NextRequest) {
  return runRefresh(request);
}

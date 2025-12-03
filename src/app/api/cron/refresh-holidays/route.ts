import { NextRequest, NextResponse } from 'next/server';
import { refreshHolidayCache } from '@/lib/holiday-cache';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

// Verify cron secret (set in environment variables)
const CRON_SECRET = process.env.CRON_SECRET || '';

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json<ApiResponse<void>>(
        {
          success: false,
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

    // Refresh holiday cache
    await refreshHolidayCache();

    return NextResponse.json<ApiResponse<void>>({
      success: true,
      message: 'Holiday cache refreshed successfully',
    });
  } catch (error) {
    console.error('Error refreshing holiday cache:', error);
    return NextResponse.json<ApiResponse<void>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh holiday cache',
      },
      { status: 500 }
    );
  }
}

// Also support GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}


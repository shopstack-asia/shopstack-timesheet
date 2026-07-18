import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ApiResponse, Holiday } from '@/types';
import { getCachedHolidays } from '@/lib/holiday-cache';

export const dynamic = 'force-dynamic';

const resolveLocation = (sessionLocation?: string | null) => {
  const trimmedSessionLocation = sessionLocation?.trim();
  if (trimmedSessionLocation) {
    return trimmedSessionLocation;
  }

  return (
    process.env.ZOHO_DEFAULT_LOCATION ||
    process.env.NEXT_PUBLIC_ZOHO_HOLIDAY_LOCATION ||
    process.env.NEXT_PUBLIC_DEFAULT_LOCATION ||
    ''
  );
};

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json<ApiResponse<Holiday[]>>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { enforceRateLimit } = await import('@/lib/rate-limit');
    const limited = await enforceRateLimit(request, {
      bucket: 'timesheet-holidays',
      limit: 60,
      windowSeconds: 60,
      userKey: session.staffProfile?.EmployeeID,
    });
    if (!limited.ok) return limited.response;

    const location = resolveLocation(session.staffProfile?.Location);

    const searchParams = request.nextUrl.searchParams;
    let yearParam = searchParams.get('year');
    
    // If year not provided, infer from current date
    if (!yearParam) {
      yearParam = new Date().getFullYear().toString();
    }

    const year = Number.parseInt(yearParam, 10);
    if (Number.isNaN(year) || year < 2000) {
      return NextResponse.json<ApiResponse<Holiday[]>>(
        {
          success: false,
          error: 'Invalid year parameter',
        },
        { status: 400 }
      );
    }

    // Get holidays from Redis cache only
    // If location is available, it will be used to filter holidays
    // If not, all holidays will be returned
    try {
      console.log('[Holiday API] Getting cached holidays for location:', location, 'and year:', year);
      const holidays = await getCachedHolidays(location || undefined, year);
      console.log('[Holiday API] Holidays:', holidays);
      return NextResponse.json<ApiResponse<Holiday[]>>({
        success: true,
        data: holidays,
      });
    } catch (error) {
      console.error('[Holiday API] Failed to get cached holidays:', error);
      return NextResponse.json<ApiResponse<Holiday[]>>(
        {
          success: false,
          error: 'Failed to retrieve holidays from cache. Please contact administrator to refresh holiday cache.',
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[API] Failed to fetch holidays:', error);
    return NextResponse.json<ApiResponse<Holiday[]>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch holidays',
      },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getYearlyHolidays } from '@/lib/zoho/getYearlyHolidays';
import { ApiResponse, Holiday } from '@/types';
import { getCachedValue, setCachedValue } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_VERSION = 'v2';

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

    const location = resolveLocation(session.staffProfile?.Location);
    if (!location) {
      return NextResponse.json<ApiResponse<Holiday[]>>(
        {
          success: false,
          error: 'Unable to determine staff location from profile',
        },
        { status: 400 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const yearParam = searchParams.get('year');

    if (!yearParam) {
      return NextResponse.json<ApiResponse<Holiday[]>>(
        {
          success: false,
          error: 'Missing required parameter: year',
        },
        { status: 400 }
      );
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

    const cacheKey = `holidays:${CACHE_VERSION}:${location}:${year}`;
    const cached = getCachedValue<Holiday[]>(cacheKey);

    if (cached) {
      return NextResponse.json<ApiResponse<Holiday[]>>({
        success: true,
        data: cached,
      });
    }

    const holidays = await getYearlyHolidays({ location, year });
    setCachedValue(cacheKey, holidays, CACHE_TTL_MS);

    return NextResponse.json<ApiResponse<Holiday[]>>({
      success: true,
      data: holidays,
    });
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


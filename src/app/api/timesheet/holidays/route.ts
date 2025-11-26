import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getYearlyHolidays } from '@/lib/zoho/getYearlyHolidays';
import { ApiResponse, Holiday } from '@/types';
import { getRedisClient } from '@/lib/redis';

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

    // Check Redis cache first
    const redis = getRedisClient();
    const cacheKey = `holiday:${year}`;
    
    try {
      const cached = await redis.get<Holiday[]>(cacheKey);
      if (cached) {
        console.log('Using Redis cache for holidays');
        return NextResponse.json<ApiResponse<Holiday[]>>({
          success: true,
          data: cached,
        });
      }
    } catch (redisError) {
      console.warn('[Holiday API] Redis cache read error (continuing to fetch):', redisError);
    }

    // Fetch fresh data from Zoho
    console.log('Fetching fresh holiday data from Zoho');
    const holidays = await getYearlyHolidays({ location, year });
    
    // Cache in Redis with 12 hours TTL
    try {
      await redis.setex(cacheKey, 43200, JSON.stringify(holidays));
    } catch (redisError) {
      console.warn('[Holiday API] Redis cache write error:', redisError);
    }

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


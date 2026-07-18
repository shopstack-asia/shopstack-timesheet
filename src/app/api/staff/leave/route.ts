import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getZohoPeopleService } from '@/lib/zoho-people';
import { normalizeZohoLeaveRecords } from '@/lib/leave-utils';
import { ApiResponse, LeaveDayEntry, ZohoLeaveApiResponse } from '@/types';
import { format, subMonths, addMonths } from 'date-fns';
import { getRedisClient } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json<ApiResponse<LeaveDayEntry[]>>(
        {
          success: false,
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

    // Get EmployeeID from session (required for filtering leave records)
    if (!session.staffProfile?.EmployeeID || session.staffProfile.EmployeeID.trim() === '') {
      console.error('[Leave API] EmployeeID not found in session:', {
        hasStaffProfile: !!session.staffProfile,
        employeeID: session.staffProfile?.EmployeeID,
        profileKeys: session.staffProfile ? Object.keys(session.staffProfile) : [],
      });
      
      return NextResponse.json<ApiResponse<LeaveDayEntry[]>>(
        {
          success: false,
          error: 'EmployeeID not found in session. Please ensure employee profile includes EmployeeID.',
        },
        { status: 404 }
      );
    }

    const employeeId = session.staffProfile.EmployeeID;

    const { enforceRateLimit } = await import('@/lib/rate-limit');
    const limited = await enforceRateLimit(request, {
      bucket: 'staff-leave',
      limit: 60,
      windowSeconds: 60,
      userKey: employeeId,
    });
    if (!limited.ok) return limited.response;

    // Get date range from query params or default to 3 months range
    const searchParams = request.nextUrl.searchParams;
    const fromDate = searchParams.get('from') || format(subMonths(new Date(), 3), 'yyyy-MM-dd');
    const toDate = searchParams.get('to') || format(addMonths(new Date(), 3), 'yyyy-MM-dd');

    // Check Redis cache first using EmployeeID
    const redis = getRedisClient();
    const cacheKey = `leave:${employeeId}:${fromDate}:${toDate}`;
    
    try {
      const cached = await redis.get<ZohoLeaveApiResponse>(cacheKey);
      if (cached) {
        console.log('Using Redis cache for leaves');
        // Normalize cached data
        const normalizedLeaveData = normalizeZohoLeaveRecords(cached);
        return NextResponse.json<ApiResponse<LeaveDayEntry[]>>({
          success: true,
          data: normalizedLeaveData,
        });
      }
    } catch (redisError) {
      console.warn('[Leave API] Redis cache read error (continuing to fetch):', redisError);
    }

    // Fetch fresh data from Zoho
    console.log('Fetching fresh leave data from Zoho');
    const zohoService = getZohoPeopleService();
    const apiResponse = await zohoService.fetchLeaveRecords(employeeId, fromDate, toDate);

    // Cache the response with 6 hours TTL
    try {
      await redis.setex(cacheKey, 21600, JSON.stringify(apiResponse));
    } catch (redisError) {
      console.warn('[Leave API] Redis cache write error:', redisError);
    }

    // Normalize leave data (expand date ranges)
    const normalizedLeaveData = normalizeZohoLeaveRecords(apiResponse);

    return NextResponse.json<ApiResponse<LeaveDayEntry[]>>({
      success: true,
      data: normalizedLeaveData,
    });
  } catch (error) {
    console.error('Error fetching leave data:', error);
    return NextResponse.json<ApiResponse<LeaveDayEntry[]>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch leave data',
      },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ApiResponse, TimeEntry } from '@/types';
import { getWeeklyTimesheetForStaff } from '@/lib/timesheet/timesheet-service';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.staffProfile) {
      return NextResponse.json<ApiResponse<TimeEntry[]>>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const limited = await enforceRateLimit(request, {
      bucket: 'timesheet-get',
      limit: 120,
      windowSeconds: 60,
      userKey: session.staffProfile.EmployeeID,
      failOpen: false,
    });
    if (!limited.ok) return limited.response;

    const weekStart = request.nextUrl.searchParams.get('weekStart');
    if (!weekStart) {
      return NextResponse.json<ApiResponse<TimeEntry[]>>(
        {
          success: false,
          error: 'weekStart parameter is required (YYYY-MM-DD)',
        },
        { status: 400 }
      );
    }

    const entriesByDate = await getWeeklyTimesheetForStaff(
      { staff: session.staffProfile, source: 'session' },
      weekStart
    );

    return NextResponse.json<ApiResponse<Record<string, TimeEntry[]>>>({
      success: true,
      data: entriesByDate,
    });
  } catch (error) {
    console.error('Error fetching time log entries:', error);
    return NextResponse.json<ApiResponse<TimeEntry[]>>(
      {
        success: false,
        error: 'Failed to fetch time log entries',
      },
      { status: 500 }
    );
  }
}

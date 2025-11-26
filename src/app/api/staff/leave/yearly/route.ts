import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getZohoPeopleService } from '@/lib/zoho-people';
import { normalizeZohoLeaveRecords } from '@/lib/leave-utils';
import { ApiResponse, LeaveDayEntry } from '@/types';
import { format } from 'date-fns';

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
      console.error('[Leave Yearly API] EmployeeID not found in session:', {
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

    // Get year from query params or default to current year
    const searchParams = request.nextUrl.searchParams;
    const yearParam = searchParams.get('year');
    const year = yearParam ? Number.parseInt(yearParam, 10) : new Date().getFullYear();

    if (Number.isNaN(year) || year < 2000) {
      return NextResponse.json<ApiResponse<LeaveDayEntry[]>>(
        {
          success: false,
          error: 'Invalid year parameter',
        },
        { status: 400 }
      );
    }

    // Build date range for entire year
    const fromDate = format(new Date(year, 0, 1), 'yyyy-MM-dd');
    const toDate = format(new Date(year, 11, 31), 'yyyy-MM-dd');

    // Fetch leave data from Zoho People using Leave API v2
    // API returns all records, we filter by EmployeeId in the service
    const zohoService = getZohoPeopleService();
    const apiResponse = await zohoService.fetchLeaveRecords(employeeId, fromDate, toDate);

    // Normalize leave data (expand date ranges)
    const normalizedLeaveData = normalizeZohoLeaveRecords(apiResponse);

    return NextResponse.json<ApiResponse<LeaveDayEntry[]>>({
      success: true,
      data: normalizedLeaveData,
    });
  } catch (error) {
    console.error('Error fetching yearly leave data:', error);
    return NextResponse.json<ApiResponse<LeaveDayEntry[]>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch yearly leave data',
      },
      { status: 500 }
    );
  }
}


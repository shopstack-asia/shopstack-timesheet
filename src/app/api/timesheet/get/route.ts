import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getGoogleSheetsService } from '@/lib/google-sheets';
import { ApiResponse, TimeLogRow, TimeEntry } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !session.staffProfile) {
      return NextResponse.json<ApiResponse<TimeEntry[]>>(
        {
          success: false,
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

    // Get week start date from query params
    const searchParams = request.nextUrl.searchParams;
    const weekStart = searchParams.get('weekStart'); // YYYY-MM-DD format

    if (!weekStart) {
      return NextResponse.json<ApiResponse<TimeEntry[]>>(
        {
          success: false,
          error: 'weekStart parameter is required (YYYY-MM-DD)',
        },
        { status: 400 }
      );
    }

    // Calculate week end date (Friday, 5 days after Monday)
    const startDate = new Date(weekStart);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 4); // Friday

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    console.log(`[API] Fetching time logs for staff ${session.staffProfile.EmployeeID} from ${startDateStr} to ${endDateStr}`);

    // Get time log entries from Google Sheets
    const sheetsService = getGoogleSheetsService();
    const timeLogEntries = await sheetsService.getTimeLogEntries(startDateStr, endDateStr);

    // Filter entries for this staff member
    const staffEntries = timeLogEntries.filter(
      (entry) => entry['Staff ID'] === session.staffProfile!.EmployeeID
    );

    console.log(`[API] Found ${staffEntries.length} time log entries for staff ${session.staffProfile.EmployeeID}`);
    console.log(`[API] Sample entries:`, staffEntries.slice(0, 3).map(e => ({
      date: e.Date,
      staffId: e['Staff ID'],
      projectId: e['Project ID'],
      taskId: e['Task ID'],
      hours: e.Hours
    })));

    // Group entries by date and convert to TimeEntry format
    const entriesByDate: Record<string, TimeEntry[]> = {};
    const seenIds = new Set<string>(); // Track seen entries to prevent duplicates
    
    staffEntries.forEach((entry) => {
      const date = entry.Date;
      // Use Time Log ID directly as unique identifier (it's already unique)
      const uniqueId = entry['Time Log ID'] || `existing-${date}-${entry['Project ID']}-${entry['Task ID']}`;
      
      // Skip if we've already seen this exact entry (same Time Log ID)
      if (seenIds.has(uniqueId)) {
        console.warn(`[API] Duplicate entry detected: ${uniqueId}`);
        return;
      }
      
      seenIds.add(uniqueId);
      
      if (!entriesByDate[date]) {
        entriesByDate[date] = [];
      }
      
      entriesByDate[date].push({
        id: uniqueId,
        projectId: entry['Project ID'],
        taskId: entry['Task ID'],
        hours: entry.Hours,
      });
    });
    
    console.log(`[API] Grouped entries by date:`, Object.keys(entriesByDate).map(date => ({
      date,
      count: entriesByDate[date].length
    })));
    
    // Log all dates found
    const allDates = staffEntries.map(e => e.Date);
    console.log(`[API] All dates found in entries:`, [...new Set(allDates)]);

    return NextResponse.json<ApiResponse<Record<string, TimeEntry[]>>>({
      success: true,
      data: entriesByDate,
    });
  } catch (error) {
    console.error('Error fetching time log entries:', error);
    return NextResponse.json<ApiResponse<TimeEntry[]>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch time log entries',
      },
      { status: 500 }
    );
  }
}


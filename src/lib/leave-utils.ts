import { LeaveDayEntry, ZohoLeaveApiResponse, ZohoLeaveRecord, ZohoLeaveDayDetail } from '@/types';
import { format, parseISO } from 'date-fns';

/**
 * Normalize Zoho Leave API v2 records by extracting dates from Days object
 * @param apiResponse Response from Zoho Leave API v2 (already filtered by EmployeeId)
 * @returns Array of LeaveDayEntry with each date from Days object
 */
export function normalizeZohoLeaveRecords(apiResponse: ZohoLeaveApiResponse): LeaveDayEntry[] {
  const normalized: LeaveDayEntry[] = [];

  // Extract records from response
  const records = apiResponse.records || {};

  // Iterate through all records
  Object.values(records).forEach((record: ZohoLeaveRecord) => {
    const leaveType = record.Leavetype || '';
    const reason = record.Reason || '';
    const status = record.ApprovalStatus || '';
    const fromDate = record.From || '';
    const toDate = record.To || '';

    // Extract dates from Days object (keys are dates)
    if (!record.Days || typeof record.Days !== 'object') {
      console.warn('[LeaveUtils] Skipping leave record with missing Days object:', record);
      return;
    }

    // Process each day in the Days object
    Object.keys(record.Days).forEach((dateStr) => {
      const dayDetail: ZohoLeaveDayDetail = record.Days[dateStr];
      
      if (!dayDetail) {
        return;
      }

      // Determine leave type from LeaveCount and Session
      const leaveCount = parseFloat(dayDetail.LeaveCount || '0');
      const session = dayDetail.Session;
      
      // LeaveCount "1.0" = full day, "0.5" or "0.0" with Session = half day
      const normalizedType: 'FULL' | 'HALF' = leaveCount >= 1.0 ? 'FULL' : 'HALF';
      
      // Determine dayType string
      let dayType = 'FULL_DAY';
      if (normalizedType === 'HALF') {
        if (session === 1) {
          dayType = 'FIRST_HALF';
        } else if (session === 2) {
          dayType = 'SECOND_HALF';
        } else {
          dayType = 'HALF_DAY';
        }
      }

      // Validate date format
      try {
        // Verify date is in YYYY-MM-DD format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateStr)) {
          console.warn('[LeaveUtils] Invalid date format in Days object:', dateStr);
          return;
        }

        normalized.push({
          date: dateStr,
          type: normalizedType,
          dayType: dayType,
          leaveType: leaveType,
          reason: reason,
          status: status,
          approvedBy: undefined, // Not available in this response structure
        });
      } catch (error) {
        console.error('[LeaveUtils] Error processing date:', {
          dateStr,
          error,
        });
      }
    });
  });

  // console.log(`[LeaveUtils] Normalized ${normalized.length} leave days from ${Object.keys(records).length} records`);
  
  return normalized;
}

/**
 * Check if a date has leave
 * @param date Date string in YYYY-MM-DD format
 * @param list Normalized leave data
 * @returns true if the date has leave
 */
export function isDateOnLeave(date: string, list: LeaveDayEntry[]): boolean {
  return list.some((leave) => leave.date === date);
}

/**
 * Get leave entry for a specific date
 * @param date Date string in YYYY-MM-DD format
 * @param list Normalized leave data
 * @returns LeaveDayEntry if leave exists, null otherwise
 */
export function getLeaveEntry(
  date: string,
  list: LeaveDayEntry[]
): LeaveDayEntry | null {
  const leave = list.find((l) => l.date === date);
  return leave || null;
}

/**
 * Check if a date has full day leave
 * @param date Date string in YYYY-MM-DD format
 * @param list Normalized leave data
 * @returns true if the date has full day leave
 */
export function isFullLeave(date: string, list: LeaveDayEntry[]): boolean {
  const leave = getLeaveEntry(date, list);
  return leave ? leave.type === 'FULL' : false;
}

/**
 * Check if a date has half day leave
 * @param date Date string in YYYY-MM-DD format
 * @param list Normalized leave data
 * @returns true if the date has half day leave
 */
export function isHalfLeave(date: string, list: LeaveDayEntry[]): boolean {
  const leave = getLeaveEntry(date, list);
  return leave ? leave.type === 'HALF' : false;
}

// Legacy functions for backward compatibility (using old NormalizedLeaveDay type)
import { NormalizedLeaveDay } from '@/types';

/**
 * Parse attendance status to determine leave type (legacy)
 */
export function parseAttendanceLeave(status: string): 'FULL' | 'FIRST_HALF' | 'SECOND_HALF' | null {
  if (!status) return null;
  
  const statusLower = status.toLowerCase().trim();
  
  if (statusLower === 'full day leave' || statusLower === 'fullday leave' || statusLower === 'full day') {
    return 'FULL';
  }
  
  if (statusLower === 'first half leave' || statusLower === 'first half' || statusLower === 'firsthalf leave') {
    return 'FIRST_HALF';
  }
  
  if (statusLower === 'second half leave' || statusLower === 'second half' || statusLower === 'secondhalf leave') {
    return 'SECOND_HALF';
  }
  
  if (statusLower.includes('leave')) {
    return 'FULL';
  }
  
  return null;
}

/**
 * Normalize raw Zoho attendance data (legacy)
 */
export function normalizeLeaveData(rawAttendanceData: any[]): NormalizedLeaveDay[] {
  const normalized: NormalizedLeaveDay[] = [];

  for (const attendanceRecord of rawAttendanceData) {
    let fields: Record<string, any> = {};

    if (Array.isArray(attendanceRecord.FL)) {
      attendanceRecord.FL.forEach((field: { val: string; content: string }) => {
        fields[field.val] = field.content;
      });
    } else {
      fields = attendanceRecord as Record<string, any>;
    }

    const date = fields.date || fields.Date || fields['Date'] || '';
    const status = fields.status || fields.Status || fields['Status'] || '';

    if (!date) {
      continue;
    }

    const leaveType = parseAttendanceLeave(status);
    if (!leaveType) {
      continue;
    }

    try {
      const parsedDate = parseISO(date);
      if (isNaN(parsedDate.getTime())) {
        continue;
      }

      const dateStr = format(parsedDate, 'yyyy-MM-dd');
      
      normalized.push({
        date: dateStr,
        type: leaveType,
        leaveType: status || undefined,
        status: status || undefined,
        session: status || undefined,
        raw: attendanceRecord,
      });
    } catch (error) {
      console.error('[LeaveUtils] Error parsing date:', { date, error });
    }
  }

  return normalized;
}

/**
 * Get leave information for a specific date (legacy)
 */
export function getLeaveInfo(
  date: string,
  list: NormalizedLeaveDay[]
): NormalizedLeaveDay | null {
  const leave = list.find((l) => l.date === date);
  return leave || null;
}

/**
 * Get leave type for a specific date (legacy)
 */
export function getLeaveType(
  date: string,
  list: NormalizedLeaveDay[]
): 'FULL' | 'FIRST_HALF' | 'SECOND_HALF' | null {
  const leave = getLeaveInfo(date, list);
  return leave ? leave.type : null;
}

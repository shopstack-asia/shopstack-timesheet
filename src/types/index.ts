// Staff Profile from Zoho People
export interface StaffProfile {
  EmployeeID: string;
  FirstName: string;
  LastName: string;
  Nickname: string;
  Email: string;
  Position: string;
  Location?: string;
}

export interface Holiday {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  shift_name?: string;
  location_name?: string;
  remarks?: string;
  is_holiday: boolean;
}

// Project from Google Sheets
export interface Project {
  ProjectID: string;
  ProjectClient: string;
  ProjectName: string;
  ProjectCode: string;
}

// Task from Google Sheets
export interface Task {
  TaskID: string;
  Task: string;
}

// Time Entry (UI representation)
export interface TimeEntry {
  id: string;
  projectId: string;
  taskId: string;
  hours: number;
}

// Daily Timesheet Entry
export interface DailyTimesheet {
  date: string; // YYYY-MM-DD
  entries: TimeEntry[];
  totalHours: number;
}

// Weekly Timesheet
export interface WeeklyTimesheet {
  weekStart: string; // Monday date YYYY-MM-DD
  days: DailyTimesheet[];
  totalHours: number;
}

// Time Log Row (for Google Sheets submission)
export interface TimeLogRow {
  'Time Log ID': string; // Generated from Date + Staff ID + Project ID + Task ID
  Date: string;
  'Staff ID': string;
  'Staff First Name': string;
  'Staff Last Name': string;
  'Staff Position': string;
  'Project ID': string;
  'Project Client': string;
  'Project Name': string;
  'Project Code': string;
  'Task ID': string;
  Task: string;
  Hours: number;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Zoho People API Response
// Zoho People API can return data in two formats:
// 1. Old format: { response: { result: { Employees: { row: [...] } } } }
// 2. New format: [{...}, {...}] (direct array)
export type ZohoEmployeeResponse =
  | {
      response: {
        result: {
          Employees: {
            row: Array<{
              FL: Array<{
                val: string;
                content: string;
              }>;
            }>;
          };
        };
      };
    }
  | Array<Record<string, any>>;

// Leave Data Types - Zoho Leave API v2
export interface LeaveDayEntry {
  date: string; // YYYY-MM-DD (expanded)
  type: 'FULL' | 'HALF';
  dayType: string; // Zoho raw value: FULL_DAY | FIRST_HALF | SECOND_HALF
  leaveType: string;
  reason: string;
  status: string;
  approvedBy?: string;
}

// Zoho Leave API v2 Response Structure
export interface ZohoLeaveDayDetail {
  LeaveCount: string; // "1.0" for full day, "0.5" for half day, "0.0" for half day
  StartTime?: string;
  EndTime?: string;
  Session?: number; // 1 for first half, 2 for second half (only for half days)
}

export interface ZohoLeaveRecord {
  'Zoho.ID': number;
  From: string; // YYYY-MM-DD
  To: string; // YYYY-MM-DD
  Leavetype: string;
  'Leavetype.ID': number;
  Reason?: string;
  ApprovalStatus: string; // "Approved", "Pending", "Cancelled", "Rejected"
  EmployeeId: string; // e.g., "S0005"
  Employee: string;
  ZUID: number;
  'Employee.ID': number;
  Days: Record<string, ZohoLeaveDayDetail>; // Keys are dates (YYYY-MM-DD)
  DateOfRequest?: string;
  [key: string]: any;
}

export interface ZohoLeaveApiResponse {
  records?: Record<string, ZohoLeaveRecord>; // Keys are record IDs
  [key: string]: any;
}

// Legacy types (kept for backward compatibility)
export interface NormalizedLeaveDay {
  date: string; // YYYY-MM-DD
  type: 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';
  leaveType?: string;
  reason?: string;
  status?: string;
  session?: string;
  raw: any; // Store original attendance record
}

// Zoho Attendance API Response
export interface ZohoAttendanceResponse {
  response?: {
    result?: {
      attendance?: {
        row?: Array<{
          FL: Array<{
            val: string;
            content: string;
          }>;
        }>;
      };
    };
  };
  // New format: direct array or object
  [key: string]: any;
}



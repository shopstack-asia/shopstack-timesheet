// Staff Profile from Zoho People
export interface StaffProfile {
  EmployeeID: string;
  FirstName: string;
  LastName: string;
  Nickname: string;
  Email: string;
  Position: string;
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


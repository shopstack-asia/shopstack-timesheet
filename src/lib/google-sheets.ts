import { google } from 'googleapis';
import { Project, Task, TimeLogRow } from '@/types';

export class GoogleSheetsService {
  private spreadsheetId: string;
  private sheets: any;

  constructor() {
    this.spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '';

    if (!this.spreadsheetId) {
      throw new Error('Google Sheets Spreadsheet ID is missing');
    }

    // Initialize Google Sheets API with service account
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
  }

  /**
   * Get all projects from Projects sheet
   */
  async getProjects(): Promise<Project[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Projects!A2:D', // Skip header row
      });

      const rows = response.data.values || [];

      return rows
        .filter((row: any[]) => row.length >= 4 && row[0]) // Filter empty rows
        .map((row: any[]) => ({
          ProjectID: String(row[0] || ''),
          ProjectClient: String(row[1] || ''),
          ProjectName: String(row[2] || ''),
          ProjectCode: String(row[3] || ''),
        }));
    } catch (error) {
      console.error('Error fetching projects from Google Sheets:', error);
      throw new Error('Failed to fetch projects from Google Sheets');
    }
  }

  /**
   * Get all tasks from Roles and Tasks sheet
   */
  async getTasks(): Promise<Task[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Roles and Tasks!A2:B', // Skip header row
      });

      const rows = response.data.values || [];

      return rows
        .filter((row: any[]) => row.length >= 2 && row[0]) // Filter empty rows
        .map((row: any[]) => ({
          TaskID: String(row[0] || ''),
          Task: String(row[1] || ''),
        }));
    } catch (error) {
      console.error('Error fetching tasks from Google Sheets:', error);
      throw new Error('Failed to fetch tasks from Google Sheets');
    }
  }

  /**
   * Get the last Time Log ID from Time Log sheet
   */
  async getLastTimeLogId(): Promise<number> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Time Log!A2:A', // Column A contains Time Log ID
      });

      const rows = response.data.values || [];
      if (rows.length === 0) {
        return 0;
      }

      // Find the maximum ID
      const ids = rows
        .map((row: any[]) => parseInt(row[0], 10))
        .filter((id: number) => !isNaN(id));

      return ids.length > 0 ? Math.max(...ids) : 0;
    } catch (error) {
      console.error('Error fetching last Time Log ID:', error);
      // Return 0 if sheet doesn't exist or is empty
      return 0;
    }
  }

  /**
   * Append time log entries to Time Log sheet
   */
  async appendTimeLogEntries(entries: TimeLogRow[]): Promise<void> {
    try {
      // Convert entries to rows
      const rows = entries.map((entry) => [
        entry['Time Log ID'],
        entry.Date,
        entry['Staff ID'],
        entry['Staff First Name'],
        entry['Staff Last Name'],
        entry['Staff Position'],
        entry['Project ID'],
        entry['Project Client'],
        entry['Project Name'],
        entry['Project Code'],
        entry['Task ID'],
        entry.Task,
        entry.Hours,
      ]);

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'Time Log!A:M',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: rows,
        },
      });
    } catch (error) {
      console.error('Error appending time log entries:', error);
      throw new Error('Failed to write time log entries to Google Sheets');
    }
  }

  /**
   * Get time log entries for a specific date range (optional, for viewing)
   */
  async getTimeLogEntries(startDate: string, endDate: string): Promise<TimeLogRow[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Time Log!A2:M',
      });

      const rows = response.data.values || [];

      return rows
        .filter((row: any[]) => {
          if (row.length < 2) return false;
          const date = row[1]; // Column B is Date
          return date >= startDate && date <= endDate;
        })
        .map((row: any[]) => ({
          'Time Log ID': parseInt(row[0], 10),
          Date: row[1],
          'Staff ID': row[2],
          'Staff First Name': row[3],
          'Staff Last Name': row[4],
          'Staff Position': row[5],
          'Project ID': row[6],
          'Project Client': row[7],
          'Project Name': row[8],
          'Project Code': row[9],
          'Task ID': row[10],
          Task: row[11],
          Hours: parseFloat(row[12]) || 0,
        }));
    } catch (error) {
      console.error('Error fetching time log entries:', error);
      throw new Error('Failed to fetch time log entries from Google Sheets');
    }
  }
}

// Singleton instance with caching
let sheetsServiceInstance: GoogleSheetsService | null = null;
let projectsCache: Project[] | null = null;
let tasksCache: Task[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function getGoogleSheetsService(): GoogleSheetsService {
  if (!sheetsServiceInstance) {
    sheetsServiceInstance = new GoogleSheetsService();
  }
  return sheetsServiceInstance;
}

/**
 * Get cached projects or fetch from Google Sheets
 */
export async function getCachedProjects(): Promise<Project[]> {
  const now = Date.now();
  if (projectsCache && now - cacheTimestamp < CACHE_TTL) {
    return projectsCache;
  }

  const service = getGoogleSheetsService();
  projectsCache = await service.getProjects();
  cacheTimestamp = now;
  return projectsCache;
}

/**
 * Get cached tasks or fetch from Google Sheets
 */
export async function getCachedTasks(): Promise<Task[]> {
  const now = Date.now();
  if (tasksCache && now - cacheTimestamp < CACHE_TTL) {
    return tasksCache;
  }

  const service = getGoogleSheetsService();
  tasksCache = await service.getTasks();
  cacheTimestamp = now;
  return tasksCache;
}

/**
 * Clear cache (useful after updates)
 */
export function clearSheetsCache(): void {
  projectsCache = null;
  tasksCache = null;
  cacheTimestamp = 0;
}


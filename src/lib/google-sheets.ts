import { google } from 'googleapis';
import { Project, Task, TimeLogRow } from '@/types';

export class GoogleSheetsService {
  private spreadsheetId: string;
  private sheets: any;

  constructor() {
    this.spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '';

    if (!this.spreadsheetId) {
      console.error('[Google Sheets] Missing environment variables:');
      console.error('[Google Sheets] GOOGLE_SHEETS_SPREADSHEET_ID:', process.env.GOOGLE_SHEETS_SPREADSHEET_ID ? 'SET' : 'MISSING');
      console.error('[Google Sheets] GOOGLE_SERVICE_ACCOUNT_EMAIL:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'SET' : 'MISSING');
      console.error('[Google Sheets] GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:', process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ? 'SET' : 'MISSING');
      throw new Error('Google Sheets Spreadsheet ID is missing. Please check your .env file and restart the server.');
    }

    // Initialize Google Sheets API with service account
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
    
    if (!serviceAccountEmail || !privateKey) {
      console.error('[Google Sheets] Missing service account credentials:');
      console.error('[Google Sheets] GOOGLE_SERVICE_ACCOUNT_EMAIL:', serviceAccountEmail ? 'SET' : 'MISSING');
      console.error('[Google Sheets] GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:', privateKey ? 'SET' : 'MISSING');
      throw new Error('Google Service Account credentials are missing. Please check your .env file.');
    }
    
    console.log(`[Google Sheets] Using service account: ${serviceAccountEmail.substring(0, 20)}...`);
    
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: serviceAccountEmail,
        private_key: privateKey,
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
      console.log(`[Google Sheets] Fetching projects from spreadsheet: ${this.spreadsheetId}`);
      console.log(`[Google Sheets] Range: Projects!A2:D`);
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Projects!A2:D', // Skip header row
      });

      const rows = response.data.values || [];
      console.log(`[Google Sheets] Found ${rows.length} project rows`);

      return rows
        .filter((row: any[]) => row.length >= 4 && row[0]) // Filter empty rows
        .map((row: any[]) => ({
          ProjectID: String(row[0] || ''),
          ProjectClient: String(row[1] || ''),
          ProjectName: String(row[2] || ''),
          ProjectCode: String(row[3] || ''),
        }));
    } catch (error: any) {
      console.error('[Google Sheets] Error fetching projects:', error);
      
      if (error.response?.data?.error) {
        const apiError = error.response.data.error;
        console.error('[Google Sheets] API Error:', {
          code: apiError.code,
          message: apiError.message,
          status: apiError.status,
        });
        
        if (apiError.message?.includes('not supported for this document')) {
          throw new Error(
            'Google Sheets access denied. Please ensure:\n' +
            '1. The Google Sheet is shared with the service account email\n' +
            '2. The service account has "Editor" or "Viewer" permission\n' +
            '3. The sheet name "Projects" exists in the spreadsheet\n' +
            `Service account email: ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'NOT SET'}`
          );
        }
      }
      
      throw new Error(`Failed to fetch projects from Google Sheets: ${error.message}`);
    }
  }

  /**
   * Get all tasks from Roles and Tasks sheet
   */
  async getTasks(): Promise<Task[]> {
    try {
      console.log(`[Google Sheets] Fetching tasks from spreadsheet: ${this.spreadsheetId}`);
      console.log(`[Google Sheets] Range: Roles and Tasks!A2:B`);
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Roles and Tasks!A2:B', // Skip header row
      });

      const rows = response.data.values || [];
      console.log(`[Google Sheets] Found ${rows.length} task rows`);

      return rows
        .filter((row: any[]) => row.length >= 2 && row[0]) // Filter empty rows
        .map((row: any[]) => ({
          TaskID: String(row[0] || ''),
          Task: String(row[1] || ''),
        }));
    } catch (error: any) {
      console.error('[Google Sheets] Error fetching tasks:', error);
      
      if (error.response?.data?.error) {
        const apiError = error.response.data.error;
        console.error('[Google Sheets] API Error:', {
          code: apiError.code,
          message: apiError.message,
          status: apiError.status,
        });
        
        if (apiError.message?.includes('not supported for this document')) {
          throw new Error(
            'Google Sheets access denied. Please ensure:\n' +
            '1. The Google Sheet is shared with the service account email\n' +
            '2. The service account has "Editor" or "Viewer" permission\n' +
            '3. The sheet name "Roles and Tasks" exists in the spreadsheet\n' +
            `Service account email: ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'NOT SET'}`
          );
        }
      }
      
      throw new Error(`Failed to fetch tasks from Google Sheets: ${error.message}`);
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
   * Find existing time log entry by Date, Staff ID, Project ID, and Task ID
   * Returns an object with row number and existing Time Log ID if found, or null if not found
   */
  async findExistingTimeLogEntry(
    date: string,
    staffId: string,
    projectId: string,
    taskId: string
  ): Promise<{ rowNumber: number; timeLogId: number } | null> {
    try {
      // Get all time log entries
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Time Log!A2:M', // Skip header row
      });

      const rows = response.data.values || [];
      
      // Search for matching entry
      // Column order: Time Log ID (A), Date (B), Staff ID (C), Project ID (G), Task ID (K)
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (
          row.length >= 11 &&
          row[1] === date && // Date (column B, index 1)
          row[2] === staffId && // Staff ID (column C, index 2)
          row[6] === projectId && // Project ID (column G, index 6)
          row[10] === taskId // Task ID (column K, index 10)
        ) {
          // Return row number (2-indexed because we skipped header, so +2) and existing ID
          const timeLogId = row[0] ? parseInt(String(row[0]), 10) : 0;
          return {
            rowNumber: i + 2,
            timeLogId: isNaN(timeLogId) ? 0 : timeLogId,
          };
        }
      }

      return null;
    } catch (error) {
      console.error('Error finding existing time log entry:', error);
      // If sheet doesn't exist or is empty, return null
      return null;
    }
  }

  /**
   * Update time log entry at specific row
   */
  async updateTimeLogEntry(rowNumber: number, entry: TimeLogRow): Promise<void> {
    try {
      const row = [
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
      ];

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Time Log!A${rowNumber}:M${rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [row],
        },
      });

      console.log(`[Google Sheets] Updated time log entry at row ${rowNumber}`);
    } catch (error) {
      console.error('Error updating time log entry:', error);
      throw new Error('Failed to update time log entry in Google Sheets');
    }
  }

  /**
   * Append or update time log entries
   * If an entry with the same Date, Staff ID, Project ID, and Task ID exists, it will be updated
   * Otherwise, a new entry will be appended
   */
  async appendOrUpdateTimeLogEntries(entries: TimeLogRow[]): Promise<void> {
    try {
      const entriesToAppend: TimeLogRow[] = [];
      const updates: Array<{ rowNumber: number; entry: TimeLogRow }> = [];

      // Check each entry for existing records
      for (const entry of entries) {
        const existing = await this.findExistingTimeLogEntry(
          entry.Date,
          entry['Staff ID'],
          entry['Project ID'],
          entry['Task ID']
        );

        if (existing) {
          // Entry exists, prepare for update
          // Use existing Time Log ID to preserve it
          const entryWithExistingId = {
            ...entry,
            'Time Log ID': existing.timeLogId,
          };
          console.log(
            `[Google Sheets] Found existing entry for Date: ${entry.Date}, Staff: ${entry['Staff ID']}, Project: ${entry['Project ID']}, Task: ${entry['Task ID']} at row ${existing.rowNumber} (ID: ${existing.timeLogId})`
          );
          updates.push({ rowNumber: existing.rowNumber, entry: entryWithExistingId });
        } else {
          // New entry, prepare for append
          entriesToAppend.push(entry);
        }
      }

      // Perform updates
      for (const { rowNumber, entry } of updates) {
        await this.updateTimeLogEntry(rowNumber, entry);
      }

      // Perform appends for new entries
      if (entriesToAppend.length > 0) {
        const rows = entriesToAppend.map((entry) => [
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

        console.log(`[Google Sheets] Appended ${entriesToAppend.length} new time log entries`);
      }

      if (updates.length > 0) {
        console.log(`[Google Sheets] Updated ${updates.length} existing time log entries`);
      }
    } catch (error) {
      console.error('Error appending/updating time log entries:', error);
      throw new Error('Failed to write time log entries to Google Sheets');
    }
  }

  /**
   * Append time log entries to Time Log sheet (deprecated - use appendOrUpdateTimeLogEntries instead)
   */
  async appendTimeLogEntries(entries: TimeLogRow[]): Promise<void> {
    // Redirect to new method for backward compatibility
    return this.appendOrUpdateTimeLogEntries(entries);
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


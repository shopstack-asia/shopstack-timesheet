import { google } from 'googleapis';
import { Project, SalesProject, Task, TimeLogRow } from '@/types';
import { sanitizeSheetRow } from '@/lib/sheets-sanitize';
import {
  dateCellForSheetsWrite,
  normalizeSheetDate,
} from '@/lib/sheets-date';
import {
  buildTimeLogId,
  DROPDOWN_SHEET,
  DuplicateSalesProjectCodeError,
  operationTaskNamesFromDropdownRows,
  SALES_PROJECTS_SHEET,
  salesProjectCodeTaken,
} from '@/lib/timesheet/task-type';

function cellAsString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function cellAsHours(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapTimeLogRow(row: unknown[]): TimeLogRow {
  return {
    'Time Log ID': cellAsString(row[0]),
    Date: normalizeSheetDate(row[1]) || cellAsString(row[1]),
    'Staff ID': cellAsString(row[2]),
    'Staff First Name': cellAsString(row[3]),
    'Staff Last Name': cellAsString(row[4]),
    'Staff Position': cellAsString(row[5]),
    'Project ID': cellAsString(row[6]),
    'Project Client': cellAsString(row[7]),
    'Project Name': cellAsString(row[8]),
    'Project Code': cellAsString(row[9]),
    'Task ID': cellAsString(row[10]),
    Task: cellAsString(row[11]),
    Hours: cellAsHours(row[12]),
  };
}

export class GoogleSheetsService {
  /**
   * Generate Time Log ID from Date + Staff ID + Project ID + Task ID.
   * When both IDs are 0, Project Code and Task are part of the hash so
   * sales and operation rows on the same day stay distinct.
   */
  generateTimeLogId(
    date: string,
    staffId: string,
    projectId: string,
    taskId: string,
    projectCode?: string,
    taskName?: string
  ): string {
    return buildTimeLogId(date, staffId, projectId, taskId, projectCode, taskName);
  }
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
    
    // console.log(`[Google Sheets] Using service account: ${serviceAccountEmail.substring(0, 20)}...`);
    
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
      // console.log(`[Google Sheets] Fetching projects from spreadsheet: ${this.spreadsheetId}`);
      // console.log(`[Google Sheets] Range: Projects!A2:D`);
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Projects!A2:D', // Skip header row
      });

      const rows = response.data.values || [];
      // console.log(`[Google Sheets] Found ${rows.length} project rows`);

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
   * Get the next Project ID (running number)
   * Reads all projects and finds the highest numeric Project ID, then returns the next one
   */
  async getNextProjectId(): Promise<string> {
    try {
      const projects = await this.getProjects();
      
      // Find the highest numeric Project ID
      let maxId = 0;
      projects.forEach((project) => {
        const projectIdNum = parseInt(project.ProjectID, 10);
        if (!isNaN(projectIdNum) && projectIdNum > maxId) {
          maxId = projectIdNum;
        }
      });
      
      // Return the next Project ID as a string
      return String(maxId + 1);
    } catch (error: any) {
      console.error('[Google Sheets] Error getting next Project ID:', error);
      throw new Error(`Failed to get next Project ID: ${error.message}`);
    }
  }

  /**
   * Create a new project in Projects sheet
   * @param projectName - The name of the new project
   * @returns The newly created Project object with the generated Project ID
   */
  async createProject(projectName: string): Promise<Project> {
    try {
      // Get the next Project ID
      const projectId = await this.getNextProjectId();
      
      // Create project data
      const projectCode = `NEW-${projectName}`;
      const projectData: Project = {
        ProjectID: projectId,
        ProjectClient: '*New',
        ProjectName: projectName,
        ProjectCode: projectCode,
      };
      
      // Append new row to Projects sheet
      const row = [
        projectData.ProjectID,
        projectData.ProjectClient,
        projectData.ProjectName,
        projectData.ProjectCode,
      ];
      
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'Projects!A:D',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [sanitizeSheetRow(row)],
        },
      });
      
      // Clear cache to ensure fresh data on next read
      clearSheetsCache();
      
      // console.log(`[Google Sheets] Created new project: ${projectData.ProjectID} - ${projectData.ProjectName}`);
      
      return projectData;
    } catch (error: any) {
      console.error('[Google Sheets] Error creating project:', error);
      throw new Error(`Failed to create project in Google Sheets: ${error.message}`);
    }
  }

  /**
   * Get all tasks from Roles and Tasks sheet
   */
  async getTasks(): Promise<Task[]> {
    try {
      // console.log(`[Google Sheets] Fetching tasks from spreadsheet: ${this.spreadsheetId}`);
      // console.log(`[Google Sheets] Range: Roles and Tasks!A2:B`);
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Roles and Tasks!A2:B', // Skip header row
      });

      const rows = response.data.values || [];
      // console.log(`[Google Sheets] Found ${rows.length} task rows`);

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
   * Sales Projects sheet: Project Client, Project Name, Project Code (no Project ID).
   */
  async getSalesProjects(): Promise<SalesProject[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `'${SALES_PROJECTS_SHEET}'!A2:C`,
      });

      const rows = response.data.values || [];
      return rows
        .filter(
          (row: unknown[]) =>
            String(row?.[0] ?? '').trim() &&
            String(row?.[1] ?? '').trim() &&
            String(row?.[2] ?? '').trim()
        )
        .map((row: unknown[]) => ({
          ProjectClient: String(row[0]).trim(),
          ProjectName: String(row[1]).trim(),
          ProjectCode: String(row[2]).trim(),
        }));
    } catch (error: any) {
      console.error('[Google Sheets] Error fetching sales projects:', error);
      throw new Error(
        `Failed to fetch Sales Projects. Confirm the sheet "${SALES_PROJECTS_SHEET}" exists with columns Project Client, Project Name, and Project Code. ${error.message}`
      );
    }
  }

  /**
   * Append one Sales Projects row. Rejects a project code that already exists.
   */
  async createSalesProject(input: {
    projectClient: string;
    projectName: string;
    projectCode: string;
  }): Promise<SalesProject> {
    const projectClient = input.projectClient.trim();
    const projectName = input.projectName.trim();
    const projectCode = input.projectCode.trim();
    if (!projectClient || !projectName || !projectCode) {
      throw new Error('Client, project name, and project code are required');
    }

    const existing = await this.getSalesProjects();
    if (salesProjectCodeTaken(existing.map((project) => project.ProjectCode), projectCode)) {
      throw new DuplicateSalesProjectCodeError(projectCode);
    }

    const created: SalesProject = {
      ProjectClient: projectClient,
      ProjectName: projectName,
      ProjectCode: projectCode,
    };

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `'${SALES_PROJECTS_SHEET}'!A:C`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [
          sanitizeSheetRow([
            created.ProjectClient,
            created.ProjectName,
            created.ProjectCode,
          ]),
        ],
      },
    });

    clearSheetsCache();
    return created;
  }

  /**
   * Operation task names from the Dropdown sheet, column header "Operation Task".
   */
  async getOperationTasks(): Promise<string[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `'${DROPDOWN_SHEET}'!A1:ZZ`,
      });
      const rows = (response.data.values || []) as unknown[][];
      return operationTaskNamesFromDropdownRows(rows);
    } catch (error: any) {
      if (error instanceof Error && error.message.includes('Operation Task')) {
        throw error;
      }
      console.error('[Google Sheets] Error fetching operation tasks:', error);
      throw new Error(
        `Failed to fetch operation tasks from the "${DROPDOWN_SHEET}" sheet. Confirm that sheet exists and has an "Operation Task" column. ${error.message}`
      );
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
    taskId: string,
    projectCode?: string,
    taskName?: string
  ): Promise<{ rowNumber: number; timeLogId: string } | null> {
    try {
      // Generate expected Time Log ID
      const expectedTimeLogId = this.generateTimeLogId(
        date,
        staffId,
        projectId,
        taskId,
        projectCode,
        taskName
      );
      const zeroIds = projectId === '0' && taskId === '0';
      const code = (projectCode || '').trim();
      const task = (taskName || '').trim();
      
      // Get all time log entries
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Time Log!A2:M', // Skip header row
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      const rows = response.data.values || [];
      
      // Search for matching entry by Time Log ID or by Date + Staff ID + Project ID + Task ID
      // Column order: Time Log ID (A), Date (B), Staff ID (C), Project ID (G), Task ID (K)
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const timeLogId = cellAsString(row[0]);
        
        // Check by Time Log ID first (faster)
        if (timeLogId === expectedTimeLogId) {
          return {
            rowNumber: i + 2,
            timeLogId: expectedTimeLogId,
          };
        }
        
        // Fallback: check by Date + Staff ID + Project ID + Task ID (for backward compatibility)
        // Date may be a Sheets serial (number) or legacy ISO/text — normalize before compare.
        // Zero IDs also require Project Code and Task so sales/operation rows do not collide.
        const zeroIdentityMatches =
          !zeroIds ||
          (cellAsString(row[9]).trim() === code && cellAsString(row[11]).trim() === task);
        if (
          row.length >= 11 &&
          zeroIdentityMatches &&
          normalizeSheetDate(row[1]) === date &&
          cellAsString(row[2]) === staffId &&
          cellAsString(row[6]) === projectId &&
          cellAsString(row[10]) === taskId
        ) {
          // Use generated ID if existing ID is not in the correct format
          return {
            rowNumber: i + 2,
            timeLogId: expectedTimeLogId,
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
        dateCellForSheetsWrite(entry.Date),
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
        valueInputOption: 'RAW',
        requestBody: {
          values: [sanitizeSheetRow(row)],
        },
      });

      // console.log(`[Google Sheets] Updated time log entry at row ${rowNumber}`);
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
        // Generate Time Log ID for this entry
        const timeLogId = this.generateTimeLogId(
          entry.Date,
          entry['Staff ID'],
          entry['Project ID'],
          entry['Task ID'],
          entry['Project Code'],
          entry.Task
        );
        
        // Ensure entry has the correct Time Log ID
        const entryWithId = {
          ...entry,
          'Time Log ID': timeLogId,
        };
        
        const existing = await this.findExistingTimeLogEntry(
          entry.Date,
          entry['Staff ID'],
          entry['Project ID'],
          entry['Task ID'],
          entry['Project Code'],
          entry.Task
        );

        if (existing) {
          // Entry exists, prepare for update
          // console.log(
          //   `[Google Sheets] Found existing entry for Date: ${entry.Date}, Staff: ${entry['Staff ID']}, Project: ${entry['Project ID']}, Task: ${entry['Task ID']} at row ${existing.rowNumber} (ID: ${timeLogId})`
          // );
          updates.push({ rowNumber: existing.rowNumber, entry: entryWithId });
        } else {
          // New entry, prepare for append
          entriesToAppend.push(entryWithId);
        }
      }

      // Perform updates
      for (const { rowNumber, entry } of updates) {
        await this.updateTimeLogEntry(rowNumber, entry);
      }

      // Perform appends for new entries
      if (entriesToAppend.length > 0) {
        const rows = entriesToAppend.map((entry) =>
          sanitizeSheetRow([
            entry['Time Log ID'],
            dateCellForSheetsWrite(entry.Date),
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
          ])
        );

        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: 'Time Log!A:M',
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: rows,
          },
        });

        // console.log(`[Google Sheets] Appended ${entriesToAppend.length} new time log entries`);
      }

      if (updates.length > 0) {
        // console.log(`[Google Sheets] Updated ${updates.length} existing time log entries`);
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
   * Get all time log entries for a specific date and staff ID
   */
  async getTimeLogEntriesByDateAndStaff(
    date: string,
    staffId: string
  ): Promise<Array<{ rowNumber: number; entry: TimeLogRow }>> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Time Log!A2:M', // Skip header row
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      const rows = response.data.values || [];
      const result: Array<{ rowNumber: number; entry: TimeLogRow }> = [];

      // Column order: Time Log ID (A), Date (B), Staff ID (C), Project ID (G), Task ID (K)
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (
          row.length >= 11 &&
          normalizeSheetDate(row[1]) === date &&
          cellAsString(row[2]) === staffId
        ) {
          result.push({
            rowNumber: i + 2, // 2-indexed because we skipped header
            entry: mapTimeLogRow(row),
          });
        }
      }

      return result;
    } catch (error) {
      console.error('Error fetching time log entries by date and staff:', error);
      throw new Error('Failed to fetch time log entries from Google Sheets');
    }
  }

  /**
   * Get sheet ID by sheet name
   */
  private async getSheetIdByName(sheetName: string): Promise<number> {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const sheet = response.data.sheets?.find(
        (s: any) => s.properties?.title === sheetName
      );

      if (!sheet) {
        throw new Error(`Sheet "${sheetName}" not found`);
      }

      return sheet.properties.sheetId;
    } catch (error) {
      console.error(`Error getting sheet ID for "${sheetName}":`, error);
      throw new Error(`Failed to get sheet ID for "${sheetName}"`);
    }
  }

  /**
   * Delete time log entries by row numbers
   */
  async deleteTimeLogEntries(rowNumbers: number[]): Promise<void> {
    if (rowNumbers.length === 0) {
      return;
    }

    try {
      // Get sheet ID for "Time Log" sheet
      const sheetId = await this.getSheetIdByName('Time Log');

      // Sort row numbers in descending order to avoid index shifting issues
      const sortedRowNumbers = [...rowNumbers].sort((a, b) => b - a);

      // Delete rows one by one (Google Sheets API requires descending order)
      for (const rowNumber of sortedRowNumbers) {
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId: sheetId,
                    dimension: 'ROWS',
                    startIndex: rowNumber - 1, // Convert to 0-indexed
                    endIndex: rowNumber, // End index is exclusive
                  },
                },
              },
            ],
          },
        });
      }

      // console.log(`[Google Sheets] Deleted ${rowNumbers.length} time log entries`);
    } catch (error) {
      console.error('Error deleting time log entries:', error);
      throw new Error('Failed to delete time log entries from Google Sheets');
    }
  }

  /**
   * Get time log entries for a specific date range (optional, for viewing).
   * Reads UNFORMATTED_VALUE so Date column B is a Sheets serial (or legacy text).
   */
  async getTimeLogEntries(startDate: string, endDate: string): Promise<TimeLogRow[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Time Log!A2:M',
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      const rows = response.data.values || [];

      const filteredRows = rows.filter((row: any[]) => {
        if (row.length < 2) return false;
        const normalizedDate = normalizeSheetDate(row[1]);

        if (!normalizedDate) {
          console.warn(`[Google Sheets] Could not parse date: ${row[1]}`);
          return false;
        }

        return normalizedDate >= startDate && normalizedDate <= endDate;
      });

      return filteredRows.map((row: any[]) => mapTimeLogRow(row));
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
let salesProjectsCache: SalesProject[] | null = null;
let salesCacheTimestamp: number = 0;
let operationTasksCache: string[] | null = null;
let operationTasksCacheTimestamp: number = 0;
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

export async function getCachedSalesProjects(): Promise<SalesProject[]> {
  const now = Date.now();
  if (salesProjectsCache && now - salesCacheTimestamp < CACHE_TTL) {
    return salesProjectsCache;
  }

  const service = getGoogleSheetsService();
  salesProjectsCache = await service.getSalesProjects();
  salesCacheTimestamp = now;
  return salesProjectsCache;
}

export async function getCachedOperationTasks(): Promise<string[]> {
  const now = Date.now();
  if (operationTasksCache && now - operationTasksCacheTimestamp < CACHE_TTL) {
    return operationTasksCache;
  }

  const service = getGoogleSheetsService();
  operationTasksCache = await service.getOperationTasks();
  operationTasksCacheTimestamp = now;
  return operationTasksCache;
}

/**
 * Clear cache (useful after updates)
 */
export function clearSheetsCache(): void {
  projectsCache = null;
  tasksCache = null;
  cacheTimestamp = 0;
  salesProjectsCache = null;
  salesCacheTimestamp = 0;
  operationTasksCache = null;
  operationTasksCacheTimestamp = 0;
}


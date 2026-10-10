import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { readExpenseDriveConfig, EXPENSE_DRIVE_SCOPE } from '@/lib/expense/drive/config';
import {
  expensePersistenceBoundary,
  MODULE_PERSISTENCE,
} from '@/lib/expense/persistence';
import { EXPENSE_REQUEST_STATUSES } from '@/types/expense/request-status';

function listSources(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listSources(full));
      continue;
    }
    if (full.endsWith('.ts') && !full.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('expense module boundary', () => {
  it('keeps expense persistence off Google Sheets', () => {
    expect(MODULE_PERSISTENCE.timesheet).toBe('google-sheets');
    expect(expensePersistenceBoundary()).toBe('dedicated-transactional-database');
    const sources = listSources(path.join(process.cwd(), 'src/lib/expense'));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/from ['"]@\/lib\/google-sheets['"]/);
      const driveUpload = file.endsWith(`${path.sep}drive${path.sep}folders.ts`);
      if (!driveUpload) expect(text).not.toMatch(/from ['"]googleapis['"]/);
    }
  });

  it('defines Drive naming without enabling upload', () => {
    const config = readExpenseDriveConfig({
      GOOGLE_DRIVE_SHARED_DRIVE_ID: ' drive-1 ',
      GOOGLE_DRIVE_EXPENSES_ROOT_FOLDER_ID: '',
    });
    expect(config.implemented).toBe(false);
    expect(config.scope).toBe(EXPENSE_DRIVE_SCOPE);
    expect(config.scope).toBe('https://www.googleapis.com/auth/drive');
    expect(config.sharedDriveId).toBe('drive-1');
    expect(config.expensesRootFolderId).toBeUndefined();
  });

  it('enables Drive upload only when both folder ids are set', () => {
    const config = readExpenseDriveConfig({
      GOOGLE_DRIVE_SHARED_DRIVE_ID: 'drive-1',
      GOOGLE_DRIVE_EXPENSES_ROOT_FOLDER_ID: 'folder-1',
    });
    expect(config.implemented).toBe(true);
    expect(config.scope).toBe('https://www.googleapis.com/auth/drive');
  });

  it('limits the expense lifecycle to draft, submitted, paid, and cancelled', () => {
    expect([...EXPENSE_REQUEST_STATUSES]).toEqual(['DRAFT', 'SUBMITTED', 'PAID', 'CANCELLED']);
  });

  it('does not add a Drive scope to the Google Sheets client', () => {
    const sheets = readFileSync(
      path.join(process.cwd(), 'src/lib/google-sheets.ts'),
      'utf8'
    );
    expect(sheets).toContain('https://www.googleapis.com/auth/spreadsheets');
    expect(sheets).not.toContain('auth/drive');
  });
});

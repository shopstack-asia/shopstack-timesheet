import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const valuesGet = vi.fn();
const valuesUpdate = vi.fn();
const valuesAppend = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: class {
        constructor(_opts?: unknown) {}
      },
    },
    sheets: () => ({
      spreadsheets: {
        values: {
          get: valuesGet,
          update: valuesUpdate,
          append: valuesAppend,
        },
      },
    }),
  },
}));

function timeLogRow(overrides: {
  id?: string;
  date: string | number;
  staffId?: string;
  projectId?: string | number;
  taskId?: string | number;
  hours?: number;
}): unknown[] {
  return [
    overrides.id ?? 'abc123def4567890',
    overrides.date,
    overrides.staffId ?? 'S0107',
    'First',
    'Last',
    'Engineer',
    overrides.projectId ?? 12,
    'Client',
    'Project',
    'CODE',
    overrides.taskId ?? 3,
    'Task',
    overrides.hours ?? 2.5,
  ];
}

describe('GoogleSheetsService Time Log date handling', () => {
  const prev = {
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  };

  beforeEach(() => {
    vi.resetModules();
    valuesGet.mockReset();
    valuesUpdate.mockReset();
    valuesAppend.mockReset();
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'sheet-id';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'sa@example.com';
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n';
  });

  afterEach(() => {
    if (prev.spreadsheetId === undefined) {
      delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    } else {
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID = prev.spreadsheetId;
    }
    if (prev.email === undefined) {
      delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    } else {
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = prev.email;
    }
    if (prev.key === undefined) {
      delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    } else {
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = prev.key;
    }
  });

  async function loadService() {
    const { GoogleSheetsService } = await import('@/lib/google-sheets');
    return new GoogleSheetsService();
  }

  it('findExistingTimeLogEntry matches serial date and coerces numeric project/task ids', async () => {
    valuesGet.mockResolvedValue({
      data: {
        values: [
          timeLogRow({
            id: 'other-id',
            date: 46223, // 2026-07-20
            projectId: 12,
            taskId: 3,
          }),
        ],
      },
    });

    const service = await loadService();
    const found = await service.findExistingTimeLogEntry(
      '2026-07-20',
      'S0107',
      '12',
      '3'
    );

    expect(found?.rowNumber).toBe(2);
    expect(valuesGet).toHaveBeenCalledWith(
      expect.objectContaining({
        valueRenderOption: 'UNFORMATTED_VALUE',
        range: 'Time Log!A2:M',
      })
    );
  });

  it('findExistingTimeLogEntry matches legacy ISO text dates', async () => {
    valuesGet.mockResolvedValue({
      data: {
        values: [
          timeLogRow({
            id: 'legacy-id',
            date: '2026-07-20',
            projectId: '12',
            taskId: '3',
          }),
        ],
      },
    });

    const service = await loadService();
    const found = await service.findExistingTimeLogEntry(
      '2026-07-20',
      'S0107',
      '12',
      '3'
    );
    expect(found?.rowNumber).toBe(2);
  });

  it('getTimeLogEntriesByDateAndStaff normalizes Date to ISO and stringifies ids', async () => {
    valuesGet.mockResolvedValue({
      data: {
        values: [
          timeLogRow({
            id: 'row-id',
            date: 46223,
            projectId: 99,
            taskId: 7,
            hours: 4,
          }),
          timeLogRow({
            id: 'other-day',
            date: 46224,
            staffId: 'S0107',
          }),
        ],
      },
    });

    const service = await loadService();
    const rows = await service.getTimeLogEntriesByDateAndStaff(
      '2026-07-20',
      'S0107'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].entry.Date).toBe('2026-07-20');
    expect(rows[0].entry['Project ID']).toBe('99');
    expect(rows[0].entry['Task ID']).toBe('7');
    expect(rows[0].entry.Hours).toBe(4);
  });

  it('getTimeLogEntries filters mixed serial and text dates in range', async () => {
    valuesGet.mockResolvedValue({
      data: {
        values: [
          timeLogRow({ id: 'a', date: 46223, staffId: 'S1' }),
          timeLogRow({ id: 'b', date: '2026-07-21', staffId: 'S2' }),
          timeLogRow({ id: 'c', date: 46210, staffId: 'S3' }),
        ],
      },
    });

    const service = await loadService();
    const rows = await service.getTimeLogEntries('2026-07-20', '2026-07-21');
    expect(rows.map((r) => r.Date).sort()).toEqual([
      '2026-07-20',
      '2026-07-21',
    ]);
    expect(rows.every((r) => typeof r['Project ID'] === 'string')).toBe(true);
  });

  it('updateTimeLogEntry writes Date as a Sheets serial with RAW', async () => {
    valuesUpdate.mockResolvedValue({});
    const service = await loadService();
    await service.updateTimeLogEntry(5, {
      'Time Log ID': 'id1',
      Date: '2026-07-20',
      'Staff ID': 'S0107',
      'Staff First Name': 'A',
      'Staff Last Name': 'B',
      'Staff Position': 'Dev',
      'Project ID': '1',
      'Project Client': 'C',
      'Project Name': 'P',
      'Project Code': 'PC',
      'Task ID': '2',
      Task: 'T',
      Hours: 1,
    });

    expect(valuesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        valueInputOption: 'RAW',
      })
    );
    const written = valuesUpdate.mock.calls[0][0].requestBody.values[0];
    expect(written[1]).toBe(46223);
  });
});

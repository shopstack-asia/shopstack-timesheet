import { describe, expect, it, vi } from 'vitest';

/**
 * Failure injection for upsert-before-delete + compensating restore.
 */
describe('partial-write failure handling', () => {
  it('does not delete when upsert fails', async () => {
    const deleteMock = vi.fn();
    const upsertMock = vi.fn().mockRejectedValue(new Error('upsert boom'));

    vi.resetModules();
    vi.doMock('@/lib/google-sheets', () => ({
      getCachedProjects: async () => [
        {
          ProjectID: '1',
          ProjectClient: 'A',
          ProjectName: 'P',
          ProjectCode: 'P',
        },
      ],
      getCachedTasks: async () => [{ TaskID: '1', Task: 'Dev' }],
      getGoogleSheetsService: () => ({
        getTimeLogEntriesByDateAndStaff: async () => [
          {
            rowNumber: 2,
            entry: {
              'Time Log ID': 'x',
              Date: '2026-07-14',
              'Staff ID': 'S1',
              'Staff First Name': 'A',
              'Staff Last Name': 'B',
              'Staff Position': 'Eng',
              'Project ID': '9',
              'Project Client': 'Z',
              'Project Name': 'Old',
              'Project Code': 'OLD',
              'Task ID': '1',
              Task: 'Dev',
              Hours: 1,
            },
          },
        ],
        generateTimeLogId: () => 'newid',
        appendOrUpdateTimeLogEntries: upsertMock,
        deleteTimeLogEntries: deleteMock,
        createProject: vi.fn(),
      }),
    }));
    vi.doMock('@/lib/sheets-write-lock', () => ({
      withTimeLogWriteLock: async (fn: () => Promise<unknown>) => fn(),
      SheetsWriteLockError: class extends Error {
        code = 'LOCK_TIMEOUT';
      },
    }));

    const { submitDayTimesheetForStaff } = await import(
      '@/lib/timesheet/timesheet-service'
    );

    await expect(
      submitDayTimesheetForStaff(
        {
          staff: {
            EmployeeID: 'S1',
            FirstName: 'A',
            LastName: 'B',
            Nickname: 'A',
            Email: 'a@shopstack.asia',
            Position: 'Eng',
          },
          source: 'session',
        },
        '2026-07-14',
        [{ projectId: '1', taskId: '1', hours: 2 }],
        { allowCustomProject: true }
      )
    ).rejects.toThrow('upsert boom');

    expect(upsertMock).toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('on delete failure restores snapshot and removes upserted extras', async () => {
    const deleteMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('delete boom'))
      .mockResolvedValueOnce(undefined);
    const upsertMock = vi.fn().mockResolvedValue(undefined);

    let phase: 'initial' | 'after_upsert' | 'after_restore_upsert' = 'initial';

    const oldRow = {
      rowNumber: 2,
      entry: {
        'Time Log ID': 'old',
        Date: '2026-07-14',
        'Staff ID': 'S1',
        'Staff First Name': 'A',
        'Staff Last Name': 'B',
        'Staff Position': 'Eng',
        'Project ID': '9',
        'Project Client': 'Z',
        'Project Name': 'Old',
        'Project Code': 'OLD',
        'Task ID': '1',
        Task: 'Dev',
        Hours: 1,
      },
    };
    const newRow = {
      rowNumber: 3,
      entry: {
        'Time Log ID': 'newid',
        Date: '2026-07-14',
        'Staff ID': 'S1',
        'Staff First Name': 'A',
        'Staff Last Name': 'B',
        'Staff Position': 'Eng',
        'Project ID': '1',
        'Project Client': 'A',
        'Project Name': 'P',
        'Project Code': 'P',
        'Task ID': '1',
        Task: 'Dev',
        Hours: 2,
      },
    };

    vi.resetModules();
    vi.doMock('@/lib/google-sheets', () => ({
      getCachedProjects: async () => [
        {
          ProjectID: '1',
          ProjectClient: 'A',
          ProjectName: 'P',
          ProjectCode: 'P',
        },
      ],
      getCachedTasks: async () => [{ TaskID: '1', Task: 'Dev' }],
      getGoogleSheetsService: () => ({
        getTimeLogEntriesByDateAndStaff: async () => {
          if (phase === 'initial') {
            phase = 'after_upsert';
            return [oldRow];
          }
          if (phase === 'after_upsert') {
            phase = 'after_restore_upsert';
            // After failed delete: both old + newly upserted remain
            return [oldRow, newRow];
          }
          return [oldRow];
        },
        generateTimeLogId: () => 'newid',
        appendOrUpdateTimeLogEntries: upsertMock,
        deleteTimeLogEntries: deleteMock,
        createProject: vi.fn(),
      }),
    }));
    vi.doMock('@/lib/sheets-write-lock', () => ({
      withTimeLogWriteLock: async (fn: () => Promise<unknown>) => fn(),
      SheetsWriteLockError: class extends Error {
        code = 'LOCK_TIMEOUT';
      },
    }));

    const { submitDayTimesheetForStaff } = await import(
      '@/lib/timesheet/timesheet-service'
    );

    await expect(
      submitDayTimesheetForStaff(
        {
          staff: {
            EmployeeID: 'S1',
            FirstName: 'A',
            LastName: 'B',
            Nickname: 'A',
            Email: 'a@shopstack.asia',
            Position: 'Eng',
          },
          source: 'session',
        },
        '2026-07-14',
        [{ projectId: '1', taskId: '1', hours: 2 }],
        { allowCustomProject: true }
      )
    ).rejects.toThrow(/previous data was restored/);

    // First upsert = intended write; second = snapshot restore
    expect(upsertMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    // First delete attempt fails; second deletes extras (project 1)
    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteMock.mock.calls[1][0]).toEqual([3]);
  });

  it('on delete and restore failure throws compound error', async () => {
    const deleteMock = vi.fn().mockRejectedValue(new Error('delete boom'));
    const upsertMock = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('restore boom'));

    vi.resetModules();
    vi.doMock('@/lib/google-sheets', () => ({
      getCachedProjects: async () => [
        {
          ProjectID: '1',
          ProjectClient: 'A',
          ProjectName: 'P',
          ProjectCode: 'P',
        },
      ],
      getCachedTasks: async () => [{ TaskID: '1', Task: 'Dev' }],
      getGoogleSheetsService: () => ({
        getTimeLogEntriesByDateAndStaff: async () => [
          {
            rowNumber: 2,
            entry: {
              'Time Log ID': 'x',
              Date: '2026-07-14',
              'Staff ID': 'S1',
              'Staff First Name': 'A',
              'Staff Last Name': 'B',
              'Staff Position': 'Eng',
              'Project ID': '9',
              'Project Client': 'Z',
              'Project Name': 'Old',
              'Project Code': 'OLD',
              'Task ID': '1',
              Task: 'Dev',
              Hours: 1,
            },
          },
        ],
        generateTimeLogId: () => 'newid',
        appendOrUpdateTimeLogEntries: upsertMock,
        deleteTimeLogEntries: deleteMock,
        createProject: vi.fn(),
      }),
    }));
    vi.doMock('@/lib/sheets-write-lock', () => ({
      withTimeLogWriteLock: async (fn: () => Promise<unknown>) => fn(),
      SheetsWriteLockError: class extends Error {
        code = 'LOCK_TIMEOUT';
      },
    }));

    const { submitDayTimesheetForStaff } = await import(
      '@/lib/timesheet/timesheet-service'
    );

    await expect(
      submitDayTimesheetForStaff(
        {
          staff: {
            EmployeeID: 'S1',
            FirstName: 'A',
            LastName: 'B',
            Nickname: 'A',
            Email: 'a@shopstack.asia',
            Position: 'Eng',
          },
          source: 'session',
        },
        '2026-07-14',
        [{ projectId: '1', taskId: '1', hours: 2 }],
        { allowCustomProject: true }
      )
    ).rejects.toThrow(/Write incomplete: delete failed.*restore also failed/);
  });
});

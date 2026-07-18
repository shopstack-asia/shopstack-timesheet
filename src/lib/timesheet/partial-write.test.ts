import { describe, expect, it, vi } from 'vitest';

/**
 * Failure injection: if upsert throws, delete must never be called.
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
});

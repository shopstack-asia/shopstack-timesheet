import { describe, expect, it, vi } from 'vitest';

describe('submitDayTimesheetForStaff task types', () => {
  const staff = {
    EmployeeID: 'S1',
    FirstName: 'A',
    LastName: 'B',
    Nickname: 'A',
    Email: 'a@shopstack.asia',
    Position: 'Eng',
  };

  async function loadSubmit(sheets: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock('@/lib/google-sheets', () => sheets);
    vi.doMock('@/lib/sheets-write-lock', () => ({
      withTimeLogWriteLock: async (fn: () => Promise<unknown>) => fn(),
      SheetsWriteLockError: class extends Error {
        code = 'LOCK_TIMEOUT';
      },
    }));
    vi.doMock('@/lib/timesheet/submit-policy', () => ({
      assertSubmitBusinessRules: async () => undefined,
      SubmitPolicyError: class extends Error {
        statusCode = 400;
      },
    }));
    const { submitDayTimesheetForStaff } = await import('@/lib/timesheet/timesheet-service');
    return submitDayTimesheetForStaff;
  }

  it('writes two sales projects as separate zero-id rows and does not create a master project', async () => {
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const createProject = vi.fn();
    const submit = await loadSubmit({
      getCachedProjects: async () => [],
      getCachedTasks: async () => [],
      getCachedSalesProjects: async () => [
        { ProjectClient: 'Contoso', ProjectName: 'Pitch', ProjectCode: 'PITCH' },
        { ProjectClient: 'Contoso', ProjectName: 'Renewal', ProjectCode: 'RENEW' },
      ],
      getCachedOperationTasks: async () => [],
      getGoogleSheetsService: () => ({
        getTimeLogEntriesByDateAndStaff: async () => [],
        appendOrUpdateTimeLogEntries: upsertMock,
        deleteTimeLogEntries: vi.fn(),
        createProject,
        generateTimeLogId: (
          date: string,
          staffId: string,
          projectId: string,
          taskId: string,
          projectCode?: string,
          taskName?: string
        ) => `${date}|${staffId}|${projectId}|${taskId}|${projectCode}|${taskName}`,
      }),
    });

    await submit(
      { staff, source: 'session' },
      '2026-10-05',
      [
        {
          taskType: 'sales_presales',
          projectId: '0',
          taskId: '0',
          hours: 2,
          projectCode: 'PITCH',
        },
        {
          taskType: 'sales_presales',
          projectId: '0',
          taskId: '0',
          hours: 1,
          projectCode: 'renew',
        },
      ],
      { allowCustomProject: true }
    );

    expect(createProject).not.toHaveBeenCalled();
    const rows = upsertMock.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      'Project ID': '0',
      'Project Client': 'Contoso',
      'Project Name': 'Pitch',
      'Project Code': 'PITCH',
      'Task ID': '0',
      Task: 'Sales & Presales',
      Hours: 2,
    });
    expect(rows[1]).toMatchObject({
      'Project Code': 'RENEW',
      Task: 'Sales & Presales',
      Hours: 1,
    });
    expect(rows[0]['Time Log ID']).not.toBe(rows[1]['Time Log ID']);
  });

  it('writes internal operations and internal development with their project rules', async () => {
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const submit = await loadSubmit({
      getCachedProjects: async () => [
        {
          ProjectID: '44',
          ProjectClient: 'Shopstack',
          ProjectName: 'Platform',
          ProjectCode: 'PLAT',
        },
      ],
      getCachedTasks: async () => [{ TaskID: '9', Task: 'Build' }],
      getCachedSalesProjects: async () => [],
      getCachedOperationTasks: async () => ['Payroll'],
      getGoogleSheetsService: () => ({
        getTimeLogEntriesByDateAndStaff: async () => [],
        appendOrUpdateTimeLogEntries: upsertMock,
        deleteTimeLogEntries: vi.fn(),
        createProject: vi.fn(),
        generateTimeLogId: () => 'id',
      }),
    });

    await submit(
      { staff, source: 'session' },
      '2026-10-05',
      [
        {
          taskType: 'internal_operations',
          projectId: '0',
          taskId: '0',
          hours: 3,
          taskName: 'payroll',
        },
        {
          taskType: 'internal_development',
          projectId: '44',
          taskId: '9',
          hours: 4,
        },
      ],
      { allowCustomProject: true }
    );

    const rows = upsertMock.mock.calls[0][0];
    expect(rows[0]).toMatchObject({
      'Project ID': '0',
      'Project Client': 'Shopstack',
      'Project Name': 'Internal Operations',
      'Project Code': 'INTERNAL_OPERATIONS',
      'Task ID': '0',
      Task: 'Payroll',
      Hours: 3,
    });
    expect(rows[1]).toMatchObject({
      'Project ID': '44',
      'Project Client': 'Shopstack',
      'Project Name': 'Platform',
      'Project Code': 'PLAT',
      'Task ID': '9',
      Task: 'Build',
      Hours: 4,
    });
  });

  it('rejects an unknown sales project code before writing', async () => {
    const upsertMock = vi.fn();
    const submit = await loadSubmit({
      getCachedProjects: async () => [],
      getCachedTasks: async () => [],
      getCachedSalesProjects: async () => [],
      getCachedOperationTasks: async () => [],
      getGoogleSheetsService: () => ({
        appendOrUpdateTimeLogEntries: upsertMock,
        generateTimeLogId: () => 'id',
      }),
    });

    await expect(
      submit(
        { staff, source: 'session' },
        '2026-10-05',
        [
          {
            taskType: 'sales_presales',
            projectId: '0',
            taskId: '0',
            hours: 1,
            projectCode: 'MISSING',
          },
        ],
        { allowCustomProject: true }
      )
    ).rejects.toThrow(/Invalid sales project code/);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rejects an internal development project that is not under Shopstack', async () => {
    const submit = await loadSubmit({
      getCachedProjects: async () => [
        {
          ProjectID: '7',
          ProjectClient: 'Acme',
          ProjectName: 'Site',
          ProjectCode: 'SITE',
        },
      ],
      getCachedTasks: async () => [{ TaskID: '1', Task: 'Dev' }],
      getCachedSalesProjects: async () => [],
      getCachedOperationTasks: async () => [],
      getGoogleSheetsService: () => ({
        appendOrUpdateTimeLogEntries: vi.fn(),
        generateTimeLogId: () => 'id',
      }),
    });

    await expect(
      submit(
        { staff, source: 'session' },
        '2026-10-05',
        [{ taskType: 'internal_development', projectId: '7', taskId: '1', hours: 1 }],
        { allowCustomProject: true }
      )
    ).rejects.toThrow(/Invalid internal development project/);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  CanonicalTimesheetReadError,
  agentAuthFromConversationIdentity,
  mapRowsToDailyTimesheet,
  mapTimeLogRowToEntry,
  readDailyTimesheetForEmployee,
  readTimesheetRangeForEmployee,
} from '@/lib/timesheet/canonical-read';
import type { TimeLogRow } from '@/types';

const EMPLOYEE = 'S0005';

function row(partial: Partial<TimeLogRow> & Pick<TimeLogRow, 'Date' | 'Hours'>): TimeLogRow {
  return {
    'Time Log ID': partial['Time Log ID'] || `tl-${partial.Date}-${partial.Hours}`,
    Date: partial.Date,
    'Staff ID': partial['Staff ID'] || EMPLOYEE,
    'Staff First Name': 'Ada',
    'Staff Last Name': 'Lovelace',
    'Staff Position': 'Dev',
    'Project ID': partial['Project ID'] || 'P1',
    'Project Client': partial['Project Client'] || 'Client',
    'Project Name': partial['Project Name'] || 'Project',
    'Project Code': partial['Project Code'] || 'CODE',
    'Task ID': partial['Task ID'] || 'T1',
    Task: partial.Task || 'Development',
    Hours: partial.Hours,
  };
}

const july18Fixture: TimeLogRow[] = [
  row({
    Date: '2026-07-18',
    'Project Client': 'Hertz',
    'Project Name': 'Commerce Suite',
    'Project Code': 'HERTZ-PLATFORM-2026-01',
    'Project ID': '73',
    Task: 'Development',
    'Task ID': '3',
    Hours: 5,
  }),
  row({
    Date: '2026-07-18',
    'Project Client': 'Mitrphol',
    'Project Name': 'Raw Material Supply Management System (RMS)',
    'Project Code': 'MIT-RMS-2025-01',
    'Project ID': '52',
    Task: 'Project Management',
    'Task ID': '5',
    Hours: 3,
  }),
  row({
    Date: '2026-07-18',
    'Project Client': 'Shopstack',
    'Project Name': 'Commerce Suite',
    'Project Code': 'SS-COMMERCE-SUTE',
    'Project ID': '70',
    Task: 'Development',
    'Task ID': '3',
    Hours: 2,
  }),
];

describe('canonical Timesheet read mapping', () => {
  it('agentAuthFromConversationIdentity populates Time Log staff name fields', () => {
    const auth = agentAuthFromConversationIdentity({
      employeeId: 'S0018',
      email: 'ada@shopstack.asia',
      slackUserId: 'U1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      position: 'Engineer',
    });
    expect(auth.staff).toMatchObject({
      EmployeeID: 'S0018',
      FirstName: 'Ada',
      LastName: 'Lovelace',
      Position: 'Engineer',
      Email: 'ada@shopstack.asia',
    });
  });

  it('agentAuthFromConversationIdentity defaults missing staff name fields to empty', () => {
    const auth = agentAuthFromConversationIdentity({
      employeeId: 'S0018',
      email: 'ada@shopstack.asia',
    });
    expect(auth.staff.FirstName).toBe('');
    expect(auth.staff.LastName).toBe('');
    expect(auth.staff.Position).toBe('');
  });

  it('maps Time Log rows to DailyTimesheet with client/project/task names', () => {
    const day = mapRowsToDailyTimesheet('2026-07-18', july18Fixture);
    expect(day.date).toBe('2026-07-18');
    expect(day.entries).toHaveLength(3);
    expect(day.totalHours).toBe(10);
    expect(day.submitted).toBe(false);
    expect(day.entries[0]).toMatchObject({
      clientName: 'Hertz',
      projectName: 'Commerce Suite (HERTZ-PLATFORM-2026-01)',
      taskName: 'Development',
      taskId: '3',
      hours: 5,
    });
    expect(day.entries[1]).toMatchObject({
      clientName: 'Mitrphol',
      projectName:
        'Raw Material Supply Management System (RMS) (MIT-RMS-2025-01)',
      taskName: 'Project Management',
      hours: 3,
    });
    expect(day.entries[2]).toMatchObject({
      clientName: 'Shopstack',
      projectName: 'Commerce Suite (SS-COMMERCE-SUTE)',
      hours: 2,
    });
    expect(day.entries[0]?.roleName).toBe('Development'); // deprecated alias
  });

  it('empty day is successful with zero hours (not an error)', () => {
    const day = mapRowsToDailyTimesheet('2026-07-19', []);
    expect(day.entries).toEqual([]);
    expect(day.totalHours).toBe(0);
    expect(day.submitted).toBe(false);
  });

  it('mapTimeLogRowToEntry preserves hours', () => {
    expect(mapTimeLogRowToEntry(july18Fixture[0]!).hours).toBe(5);
  });
});

describe('readDailyTimesheetForEmployee', () => {
  it('returns three entries totaling 10 hours for 2026-07-18', async () => {
    const day = await readDailyTimesheetForEmployee(
      { employeeId: EMPLOYEE, email: 'ada@shopstack.asia' },
      '2026-07-18',
      {
        loader: async () => july18Fixture,
      }
    );
    expect(day.entries).toHaveLength(3);
    expect(day.totalHours).toBe(10);
    expect(day.submitted).toBe(false);
  });

  it('filters out other employee rows', async () => {
    const day = await readDailyTimesheetForEmployee(
      { employeeId: EMPLOYEE, email: 'ada@shopstack.asia' },
      '2026-07-18',
      {
        loader: async () => [
          ...july18Fixture,
          row({
            Date: '2026-07-18',
            'Staff ID': 'OTHER',
            Hours: 99,
            'Project Client': 'OtherCo',
          }),
        ],
      }
    );
    expect(day.totalHours).toBe(10);
    expect(day.entries.every((e) => e.clientName !== 'OtherCo')).toBe(true);
  });

  it('submitted=false does not remove entries', async () => {
    const day = await readDailyTimesheetForEmployee(
      { employeeId: EMPLOYEE, email: 'ada@shopstack.asia' },
      '2026-07-18',
      { loader: async () => july18Fixture }
    );
    expect(day.submitted).toBe(false);
    expect(day.entries).toHaveLength(3);
  });

  it('identity mapping failure', async () => {
    await expect(
      readDailyTimesheetForEmployee(
        { employeeId: '', email: 'ada@shopstack.asia' },
        '2026-07-18',
        { loader: async () => [] }
      )
    ).rejects.toBeInstanceOf(CanonicalTimesheetReadError);

    await expect(
      readDailyTimesheetForEmployee(
        { employeeId: EMPLOYEE, email: 'not-shopstack.com' },
        '2026-07-18',
        { loader: async () => [] }
      )
    ).rejects.toMatchObject({ code: 'identity_mapping' });
  });

  it('integration failure from Sheets loader', async () => {
    await expect(
      readDailyTimesheetForEmployee(
        { employeeId: EMPLOYEE, email: 'ada@shopstack.asia' },
        '2026-07-18',
        {
          loader: async () => {
            throw new Error('Failed to fetch time log entries from Google Sheets');
          },
        }
      )
    ).rejects.toMatchObject({ code: 'integration' });
  });

  it('invalid date', async () => {
    await expect(
      readDailyTimesheetForEmployee(
        { employeeId: EMPLOYEE, email: 'ada@shopstack.asia' },
        '2026-02-30',
        { loader: async () => [] }
      )
    ).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('readTimesheetRangeForEmployee', () => {
  it('includes 2026-07-18 with 10 hours in an inclusive range', async () => {
    const range = await readTimesheetRangeForEmployee(
      { employeeId: EMPLOYEE, email: 'ada@shopstack.asia' },
      '2026-07-13',
      '2026-07-19',
      { loader: async () => july18Fixture }
    );
    const day = range.days.find((d) => d.date === '2026-07-18');
    expect(day?.entries).toHaveLength(3);
    expect(day?.totalHours).toBe(10);
    expect(range.totalHours).toBe(10);
    expect(range.days).toHaveLength(7);
  });
});

describe('error distinctions', () => {
  it('does not treat empty day as integration failure', async () => {
    const day = await readDailyTimesheetForEmployee(
      { employeeId: EMPLOYEE, email: 'ada@shopstack.asia' },
      '2026-07-18',
      { loader: async () => [] }
    );
    expect(day.entries).toEqual([]);
    expect(day.totalHours).toBe(0);
  });

  it('timeout mapping', async () => {
    await expect(
      readDailyTimesheetForEmployee(
        { employeeId: EMPLOYEE, email: 'ada@shopstack.asia' },
        '2026-07-18',
        {
          loader: async () => {
            throw new Error('ETIMEDOUT');
          },
        }
      )
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('auth mapping', async () => {
    await expect(
      readDailyTimesheetForEmployee(
        { employeeId: EMPLOYEE, email: 'ada@shopstack.asia' },
        '2026-07-18',
        {
          loader: async () => {
            throw new Error('401 Unauthorized');
          },
        }
      )
    ).rejects.toMatchObject({ code: 'authentication' });
  });
});

// silence structured logs in this file
vi.spyOn(console, 'log').mockImplementation(() => {});

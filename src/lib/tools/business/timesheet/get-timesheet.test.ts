import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextManager } from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import { createIdentityResolver } from '@/lib/conversation/context/identity-resolver';
import { createToolContext } from '@/lib/tools/tool-context';
import { createDefaultToolRegistry } from '@/lib/tools';
import {
  createGetTimesheetTool,
  parseDailyTimesheet,
} from '@/lib/tools/business/timesheet/get-timesheet';
import type { DailyTimesheet } from '@/lib/tools/business/types';
import { CanonicalTimesheetReadError } from '@/lib/timesheet/canonical-read';

const july18: DailyTimesheet = {
  date: '2026-07-18',
  entries: [
    {
      clientName: 'Hertz',
      projectName: 'Commerce Suite (HERTZ-PLATFORM-2026-01)',
      roleName: 'Development',
      hours: 5,
    },
    {
      clientName: 'Mitrphol',
      projectName:
        'Raw Material Supply Management System (RMS) (MIT-RMS-2025-01)',
      roleName: 'Project Management',
      hours: 3,
    },
    {
      clientName: 'Shopstack',
      projectName: 'Commerce Suite (SS-COMMERCE-SUTE)',
      roleName: 'Development',
      hours: 2,
    },
  ],
  totalHours: 10,
  expectedHours: 8,
  remainingHours: 0,
  submitted: false,
};

function makeDeps(readDaily: typeof july18 | (() => Promise<DailyTimesheet>)) {
  const readDailyTimesheet = async (
    identity: { employeeId: string; email: string },
    date: string
  ) => {
    expect(identity.employeeId).toBe('S0005');
    expect(identity.email).toBe('ada@shopstack.asia');
    if (typeof readDaily === 'function') {
      return readDaily();
    }
    expect(date).toBe(readDaily.date);
    return readDaily;
  };

  return {
    readDailyTimesheet,
    contextManager: createContextManager({
      store: createContextStore(),
      identityResolver: createIdentityResolver({
        lookup: async () => ({
          ok: true,
          auth: {
            staff: {
              EmployeeID: 'S0005',
              Email: 'ada@shopstack.asia',
            },
          },
        }),
      }),
    }),
  };
}

function toolCtx(signal?: AbortSignal) {
  return createToolContext({
    userId: 'U1',
    conversationId: 'conv-day',
    signal,
  });
}

describe('parseDailyTimesheet', () => {
  it('parses totals and remaining hours', () => {
    const day = parseDailyTimesheet({
      date: '2026-07-17',
      entries: [{ hours: 2 }, { hours: 1 }],
    });
    expect(day.totalHours).toBe(3);
    expect(day.remainingHours).toBe(5);
  });
});

describe('get_timesheet tool (canonical Sheets read)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns three entries totaling 10 hours for 2026-07-18', async () => {
    const tool = createGetTimesheetTool(makeDeps(july18));
    const result = await tool.execute({ date: '2026-07-18' }, toolCtx());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({
        date: '2026-07-18',
        totalHours: 10,
        submitted: false,
        employeeId: 'S0005',
      });
      const entries = (result.result as DailyTimesheet).entries;
      expect(entries).toHaveLength(3);
      expect(entries.map((e) => e.hours)).toEqual([5, 3, 2]);
    }
  });

  it('rejects AI-provided employeeId', async () => {
    const tool = createGetTimesheetTool(makeDeps(july18));
    const result = await tool.execute(
      { date: '2026-07-18', employeeId: 'HACK' },
      toolCtx()
    );
    expect(result.success).toBe(false);
  });

  it('empty day is success with zero hours', async () => {
    const tool = createGetTimesheetTool(
      makeDeps({
        date: '2026-07-18',
        entries: [],
        totalHours: 0,
        expectedHours: 8,
        remainingHours: 8,
        submitted: false,
      })
    );
    const result = await tool.execute({ date: '2026-07-18' }, toolCtx());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({ totalHours: 0, entries: [] });
    }
  });

  it('integration failure is not reported as empty day', async () => {
    const tool = createGetTimesheetTool(
      makeDeps(async () => {
        throw new CanonicalTimesheetReadError(
          'Timesheet data source integration failure (Google Sheets Time Log)',
          'integration'
        );
      })
    );
    const result = await tool.execute({ date: '2026-07-18' }, toolCtx());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('integration');
      expect(result.errorMessage).not.toMatch(/no work was logged/i);
      expect(result.errorMessage).not.toMatch(/no timesheet data exists/i);
    }
  });

  it.each([
    ['identity_mapping', 'Employee identity is not mapped'],
    ['authentication', 'Unable to authenticate'],
    ['timeout', 'did not respond in time'],
    ['validation', 'date must be a valid'],
  ] as const)('maps %s without inventing empty day', async (code, msg) => {
    const tool = createGetTimesheetTool(
      makeDeps(async () => {
        throw new CanonicalTimesheetReadError(msg, code);
      })
    );
    const result = await tool.execute({ date: '2026-07-18' }, toolCtx());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe(code);
      expect(result.errorMessage).not.toMatch(/no work was logged/i);
    }
  });

  it('abort signal', async () => {
    const ac = new AbortController();
    ac.abort();
    const tool = createGetTimesheetTool(makeDeps(july18));
    const result = await tool.execute({ date: '2026-07-18' }, toolCtx(ac.signal));
    expect(result.success).toBe(false);
  });

  it('registered in default registry', () => {
    expect(createDefaultToolRegistry().exists('get_timesheet')).toBe(true);
  });
});

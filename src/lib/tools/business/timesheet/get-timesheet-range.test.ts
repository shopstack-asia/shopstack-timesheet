import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextManager } from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import { createIdentityResolver } from '@/lib/conversation/context/identity-resolver';
import { createToolContext } from '@/lib/tools/tool-context';
import { createDefaultToolRegistry } from '@/lib/tools';
import {
  createGetTimesheetRangeTool,
  parseTimesheetRange,
} from '@/lib/tools/business/timesheet/get-timesheet-range';
import type { TimesheetRange } from '@/lib/tools/business/types';

const rangeFixture: TimesheetRange = {
  startDate: '2026-07-13',
  endDate: '2026-07-19',
  days: [
    {
      date: '2026-07-18',
      entries: [
        { clientName: 'Hertz', hours: 5, taskName: 'Development' },
        { clientName: 'Mitrphol', hours: 3, taskName: 'Project Management' },
        { clientName: 'Shopstack', hours: 2, taskName: 'Development' },
      ],
      totalHours: 10,
      expectedHours: 8,
      remainingHours: 0,
      submitted: false,
    },
  ],
  totalHours: 10,
  expectedHours: 8,
  remainingHours: 0,
  submittedDays: 0,
  unsubmittedDays: 1,
};

function makeDeps(range: TimesheetRange) {
  return {
    readTimesheetRange: async (
      identity: { employeeId: string },
      startDate: string,
      endDate: string
    ) => {
      expect(identity.employeeId).toBe('S0005');
      expect(startDate).toBe(range.startDate);
      expect(endDate).toBe(range.endDate);
      return range;
    },
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

describe('parseTimesheetRange', () => {
  it('aggregates totals', () => {
    const range = parseTimesheetRange(
      {
        days: [
          {
            date: '2026-07-13',
            entries: [{ hours: 8 }],
            totalHours: 8,
            submitted: true,
          },
        ],
      },
      '2026-07-13',
      '2026-07-13'
    );
    expect(range.totalHours).toBe(8);
  });
});

describe('get_timesheet_range tool (canonical Sheets read)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('includes 2026-07-18 with 10 hours and draft entries', async () => {
    const tool = createGetTimesheetRangeTool(makeDeps(rangeFixture));
    const result = await tool.execute(
      { startDate: '2026-07-13', endDate: '2026-07-19' },
      createToolContext({ userId: 'U1', conversationId: 'conv-range' })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toMatchObject({
        totalHours: 10,
        employeeId: 'S0005',
      });
      const days = (result.result as TimesheetRange).days;
      expect(days[0]?.submitted).toBe(false);
      expect(days[0]?.entries).toHaveLength(3);
    }
  });

  it('rejects AI employeeId', async () => {
    const tool = createGetTimesheetRangeTool(makeDeps(rangeFixture));
    const result = await tool.execute(
      {
        startDate: '2026-07-13',
        endDate: '2026-07-19',
        employeeId: 'HACK',
      },
      createToolContext({ userId: 'U1', conversationId: 'conv-range2' })
    );
    expect(result.success).toBe(false);
  });

  it('registered', () => {
    expect(createDefaultToolRegistry().exists('get_timesheet_range')).toBe(
      true
    );
  });
});

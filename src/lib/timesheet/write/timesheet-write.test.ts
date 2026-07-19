import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPendingTimesheetChangeStore } from '@/lib/timesheet/write/pending-store';
import {
  hashDaySnapshot,
  daySnapshotFromDailyEntries,
  snapshotsEqual,
} from '@/lib/timesheet/write/snapshot-hash';
import {
  prepareCreateTimesheetEntry,
  prepareUpdateTimesheetEntry,
  prepareDeleteTimesheetEntry,
  prepareSubmitTimesheet,
} from '@/lib/timesheet/write/prepare';
import { confirmTimesheetChange } from '@/lib/timesheet/write/confirm';
import { cancelTimesheetChange } from '@/lib/timesheet/write/cancel';
import type { DailyTimesheet } from '@/lib/tools/business/types';
import {
  createPrepareCreateTimesheetEntryTool,
  createConfirmTimesheetChangeTool,
  BUSINESS_WRITE_TOOLS,
} from '@/lib/tools/business/timesheet-write';
import { createDefaultToolRegistry } from '@/lib/tools';
import { decideBusinessTool } from '@/lib/ai/decision-engine';

vi.mock('@/lib/timesheet/write/master-resolve', () => ({
  formatProjectLabel: (p: { ProjectName: string; ProjectCode: string }) =>
    `${p.ProjectName} (${p.ProjectCode})`,
  resolveProject: vi.fn(async (input: { projectId?: string; projectName?: string }) => {
    if (input.projectName?.toLowerCase() === 'ambiguous') {
      return {
        status: 'ambiguous',
        candidates: [
          {
            ProjectID: 'P1',
            ProjectName: 'A',
            ProjectCode: 'A',
            ProjectClient: 'C1',
          },
          {
            ProjectID: 'P2',
            ProjectName: 'B',
            ProjectCode: 'B',
            ProjectClient: 'C2',
          },
        ],
      };
    }
    if (input.projectName?.toLowerCase() === 'unknown') {
      return { status: 'not_found' };
    }
    return {
      status: 'resolved',
      value: {
        ProjectID: input.projectId || 'P-HERTZ',
        ProjectName: 'Commerce Suite',
        ProjectCode: 'HERTZ',
        ProjectClient: 'Hertz',
      },
    };
  }),
  resolveTask: vi.fn(async (input: { taskId?: string; taskName?: string }) => {
    if (input.taskName?.toLowerCase() === 'ambiguous') {
      return {
        status: 'ambiguous',
        candidates: [
          { TaskID: 'T1', Task: 'Dev' },
          { TaskID: 'T2', Task: 'Dev2' },
        ],
      };
    }
    if (input.taskName?.toLowerCase() === 'unknown') {
      return { status: 'not_found' };
    }
    return {
      status: 'resolved',
      value: {
        TaskID: input.taskId || 'T-DEV',
        Task: 'Development',
      },
    };
  }),
}));

const identity = {
  employeeId: 'S0005',
  email: 'test@shopstack.asia',
  slackUserId: 'U1',
  conversationId: 'C1',
};

function day(
  entries: Array<{
    id: string;
    projectId: string;
    taskId: string;
    hours: number;
    clientName?: string;
    projectName?: string;
    taskName?: string;
  }>
): DailyTimesheet {
  return {
    date: '2026-07-18',
    entries: entries.map((e) => ({
      id: e.id,
      projectId: e.projectId,
      taskId: e.taskId,
      hours: e.hours,
      clientName: e.clientName || 'Client',
      projectName: e.projectName || 'Project',
      taskName: e.taskName || 'Task',
    })),
    totalHours: entries.reduce((s, e) => s + e.hours, 0),
    expectedHours: 8,
    remainingHours: 0,
    submitted: false,
  };
}

const baseEntries = [
  {
    id: 'e1',
    projectId: 'P-MIT',
    taskId: 'T-PM',
    hours: 3,
    clientName: 'Mitrphol',
    projectName: 'RMS',
    taskName: 'Project Management',
  },
  {
    id: 'e2',
    projectId: 'P-SS',
    taskId: 'T-DEV',
    hours: 2,
    clientName: 'Shopstack',
    projectName: 'Commerce Suite',
    taskName: 'Development',
  },
];

describe('snapshot hash', () => {
  it('is stable regardless of entry order', () => {
    const a = daySnapshotFromDailyEntries('2026-07-18', [
      { id: '1', projectId: 'A', taskId: 'T', hours: 1 },
      { id: '2', projectId: 'B', taskId: 'T', hours: 2 },
    ]);
    const b = daySnapshotFromDailyEntries('2026-07-18', [
      { id: '2', projectId: 'B', taskId: 'T', hours: 2 },
      { id: '1', projectId: 'A', taskId: 'T', hours: 1 },
    ]);
    expect(hashDaySnapshot(a)).toBe(hashDaySnapshot(b));
    expect(snapshotsEqual(a, b)).toBe(true);
  });
});

describe('pending store', () => {
  it('claims atomically and rejects double claim', () => {
    const store = createPendingTimesheetChangeStore();
    const snap = { date: '2026-07-18', entries: [] };
    store.create({
      confirmationId: 'confirm_a',
      operation: 'create_entry',
      conversationId: 'C1',
      slackUserId: 'U1',
      employeeId: 'S0005',
      date: '2026-07-18',
      originalSnapshot: snap,
      originalSnapshotHash: 'h1',
      proposedSnapshot: snap,
      proposedSnapshotHash: 'h2',
      summary: 's',
      summaryPayload: {},
      writeEntries: [],
    });
    expect(store.claimForExecution('confirm_a')?.status).toBe('executing');
    expect(store.claimForExecution('confirm_a')).toBeNull();
  });
});

describe('prepare create', () => {
  it('stores pending without writing and preserves other entries in proposed', async () => {
    const store = createPendingTimesheetChangeStore();
    const readDaily = vi.fn(async () => day(baseEntries));
    const result = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 5,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      {
        pendingStore: store,
        readDaily,
      }
    );
    expect(result.status).toBe('confirmation_required');
    if (result.status !== 'confirmation_required') return;
    const pending = store.get(result.confirmationId)!;
    expect(pending.proposedSnapshot.entries).toHaveLength(3);
    expect(
      pending.proposedSnapshot.entries.some((e) => e.projectId === 'P-HERTZ')
    ).toBe(true);
    expect(readDaily).toHaveBeenCalled();
  });

  it('rejects unknown project', async () => {
    const result = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 1,
        projectName: 'unknown',
        taskName: 'Development',
      },
      {
        pendingStore: createPendingTimesheetChangeStore(),
        readDaily: async () => day([]),
      }
    );
    expect(result.status).toBe('validation_failed');
  });

  it('returns clarification for ambiguous project', async () => {
    const result = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 1,
        projectName: 'ambiguous',
        taskName: 'Development',
      },
      {
        pendingStore: createPendingTimesheetChangeStore(),
        readDaily: async () => day([]),
      }
    );
    expect(result.status).toBe('clarification_required');
  });

  it('detects duplicate project+task', async () => {
    const result = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 1,
        projectId: 'P-MIT',
        taskId: 'T-PM',
      },
      {
        pendingStore: createPendingTimesheetChangeStore(),
        readDaily: async () => day(baseEntries),
      }
    );
    expect(result.status).toBe('duplicate_found');
  });
});

describe('prepare update/delete', () => {
  it('update preserves unaffected entries', async () => {
    const store = createPendingTimesheetChangeStore();
    const withHertz = [
      ...baseEntries,
      {
        id: 'e3',
        projectId: 'P-HERTZ',
        taskId: 'T-DEV',
        hours: 5,
        clientName: 'Hertz',
        projectName: 'Commerce Suite',
        taskName: 'Development',
      },
    ];
    const result = await prepareUpdateTimesheetEntry(
      identity,
      { date: '2026-07-18', entryId: 'e3', hours: 6 },
      {
        pendingStore: store,
        readDaily: async () => day(withHertz),
      }
    );
    expect(result.status).toBe('confirmation_required');
    if (result.status !== 'confirmation_required') return;
    const pending = store.get(result.confirmationId)!;
    expect(pending.proposedSnapshot.entries).toHaveLength(3);
    expect(
      pending.proposedSnapshot.entries.find((e) => e.id === 'e3')?.hours
    ).toBe(6);
    expect(
      pending.proposedSnapshot.entries.find((e) => e.id === 'e1')?.hours
    ).toBe(3);
  });

  it('delete removes only selected entry', async () => {
    const store = createPendingTimesheetChangeStore();
    const withAll = [
      ...baseEntries,
      {
        id: 'e3',
        projectId: 'P-HERTZ',
        taskId: 'T-DEV',
        hours: 5,
        clientName: 'Hertz',
        projectName: 'Commerce Suite',
        taskName: 'Development',
      },
    ];
    const result = await prepareDeleteTimesheetEntry(
      identity,
      { date: '2026-07-18', matchProjectName: 'Shopstack' },
      {
        pendingStore: store,
        readDaily: async () => day(withAll),
      }
    );
    expect(result.status).toBe('confirmation_required');
    if (result.status !== 'confirmation_required') return;
    const pending = store.get(result.confirmationId)!;
    expect(pending.proposedSnapshot.entries).toHaveLength(2);
    expect(
      pending.proposedSnapshot.entries.some((e) => e.id === 'e2')
    ).toBe(false);
  });
});

describe('prepare submit', () => {
  it('returns unsupported', async () => {
    const result = await prepareSubmitTimesheet();
    expect(result.status).toBe('unsupported');
  });
});

describe('confirm / cancel', () => {
  it('confirms once, preserves day snapshot, and is idempotent on retry', async () => {
    const store = createPendingTimesheetChangeStore();
    let sheets = day(baseEntries);
    const readDaily = vi.fn(async () => sheets);
    const submitDay = vi.fn(
      async (
        _auth: unknown,
        _date: string,
        entries: Array<{ projectId: string; taskId: string; hours: number }>
      ) => {
      sheets = day(
        entries.map((e, i) => ({
          id: `new-${i}`,
          projectId: e.projectId,
          taskId: e.taskId,
          hours: e.hours,
          clientName: e.projectId === 'P-HERTZ' ? 'Hertz' : 'Client',
          projectName: 'Commerce Suite',
          taskName: 'Development',
        }))
      );
    }
    );

    const prepared = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 5,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      { pendingStore: store, readDaily }
    );
    expect(prepared.status).toBe('confirmation_required');
    if (prepared.status !== 'confirmation_required') return;

    // Sheets unchanged before confirm
    expect(sheets.entries).toHaveLength(2);

    const confirmed = await confirmTimesheetChange(
      identity,
      prepared.confirmationId,
      { pendingStore: store, readDaily, submitDay }
    );
    expect(confirmed.status).toBe('completed');
    expect(submitDay).toHaveBeenCalledTimes(1);
    expect(sheets.totalHours).toBe(10);

    const retry = await confirmTimesheetChange(
      identity,
      prepared.confirmationId,
      { pendingStore: store, readDaily, submitDay }
    );
    expect(retry.status).toBe('completed');
    expect(submitDay).toHaveBeenCalledTimes(1);
  });

  it('detects conflict when sheets changed', async () => {
    const store = createPendingTimesheetChangeStore();
    let sheets = day(baseEntries);
    const prepared = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 5,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      {
        pendingStore: store,
        readDaily: async () => sheets,
      }
    );
    if (prepared.status !== 'confirmation_required') return;
    sheets = day([
      ...baseEntries,
      {
        id: 'extra',
        projectId: 'P-X',
        taskId: 'T-X',
        hours: 1,
      },
    ]);
    const confirmed = await confirmTimesheetChange(
      identity,
      prepared.confirmationId,
      {
        pendingStore: store,
        readDaily: async () => sheets,
        submitDay: vi.fn(),
      }
    );
    expect(confirmed.status).toBe('conflict');
  });

  it('rejects another user / conversation', async () => {
    const store = createPendingTimesheetChangeStore();
    const prepared = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 1,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      {
        pendingStore: store,
        readDaily: async () => day([]),
      }
    );
    if (prepared.status !== 'confirmation_required') return;
    const other = await confirmTimesheetChange(
      { ...identity, slackUserId: 'U_OTHER' },
      prepared.confirmationId,
      {
        pendingStore: store,
        readDaily: async () => day([]),
        submitDay: vi.fn(),
      }
    );
    expect(other.status).toBe('failed');

    const otherConv = await confirmTimesheetChange(
      { ...identity, conversationId: 'C_OTHER' },
      prepared.confirmationId,
      {
        pendingStore: store,
        readDaily: async () => day([]),
        submitDay: vi.fn(),
      }
    );
    expect(otherConv.status).toBe('failed');
  });

  it('cancel does not write', async () => {
    const store = createPendingTimesheetChangeStore();
    const submitDay = vi.fn();
    const prepared = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 1,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      {
        pendingStore: store,
        readDaily: async () => day([]),
      }
    );
    if (prepared.status !== 'confirmation_required') return;
    const cancelled = await cancelTimesheetChange(
      identity,
      prepared.confirmationId,
      { pendingStore: store }
    );
    expect(cancelled.status).toBe('cancelled');
    expect(submitDay).not.toHaveBeenCalled();
  });
});

describe('security: AI identity fields', () => {
  it('rejects employeeId on prepare tool', async () => {
    const tool = createPrepareCreateTimesheetEntryTool({
      contextManager: {
        getConversationContext: async () => ({
          conversationId: 'C1',
          slackUserId: 'U1',
          employeeId: 'S0005',
          slackEmail: 'test@shopstack.asia',
          loadedAt: new Date(),
        }),
      } as never,
      pendingStore: createPendingTimesheetChangeStore(),
      readDaily: async () => day([]),
    });
    const result = await tool.execute(
      {
        date: '2026-07-18',
        hours: 1,
        projectName: 'Hertz',
        taskName: 'Development',
        employeeId: 'S9999',
      },
      {
        conversationId: 'C1',
        userId: 'U1',
        metadata: { slackUserId: 'U1', conversationId: 'C1' },
      }
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toMatch(/employeeId/i);
    }
  });

  it('rejects mutation fields on confirm', async () => {
    const tool = createConfirmTimesheetChangeTool({
      contextManager: {
        getConversationContext: async () => ({
          conversationId: 'C1',
          slackUserId: 'U1',
          employeeId: 'S0005',
          slackEmail: 'test@shopstack.asia',
          loadedAt: new Date(),
        }),
      } as never,
    });
    const result = await tool.execute(
      { confirmationId: 'x', hours: 5 },
      {
        conversationId: 'C1',
        userId: 'U1',
        metadata: { slackUserId: 'U1', conversationId: 'C1' },
      }
    );
    expect(result.success).toBe(false);
  });

  it('does not register direct write tools', () => {
    const names = BUSINESS_WRITE_TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'prepare_create_timesheet_entry',
        'prepare_update_timesheet_entry',
        'prepare_delete_timesheet_entry',
        'prepare_submit_timesheet',
        'confirm_timesheet_change',
        'cancel_timesheet_change',
      ])
    );
    expect(names.some((n) => n.includes('submit_day'))).toBe(false);
    const registry = createDefaultToolRegistry();
    expect(registry.exists('submit_day_timesheet')).toBe(false);
    expect(registry.exists('clear_day_timesheet')).toBe(false);
  });
});

describe('decision engine write routing', () => {
  const now = new Date('2026-07-19T10:00:00+07:00');

  it('routes create intent to prepare_create', () => {
    const d = decideBusinessTool(
      'ลงเวลาเมื่อวานให้ Hertz งาน Development 5 ชั่วโมง',
      { now }
    );
    expect(d).toMatchObject({
      action: 'call_tool',
      toolName: 'prepare_create_timesheet_entry',
      arguments: {
        date: '2026-07-18',
        hours: 5,
        projectName: 'Hertz',
        taskName: 'Development',
      },
    });
  });

  it('routes bare confirm only with pending', () => {
    expect(decideBusinessTool('ยืนยัน', { now })).toMatchObject({
      action: 'clarify',
      reason: 'confirm_without_pending',
    });
    expect(
      decideBusinessTool('ยืนยัน', {
        now,
        pendingChanges: [
          { confirmationId: 'confirm_x', summary: 'ต้องการบันทึก' },
        ],
      })
    ).toMatchObject({
      action: 'call_tool',
      toolName: 'confirm_timesheet_change',
      arguments: { confirmationId: 'confirm_x' },
    });
  });

  it('routes submit to prepare_submit', () => {
    expect(
      decideBusinessTool('Submit Timesheet สัปดาห์นี้', { now })
    ).toMatchObject({
      action: 'call_tool',
      toolName: 'prepare_submit_timesheet',
    });
  });
});

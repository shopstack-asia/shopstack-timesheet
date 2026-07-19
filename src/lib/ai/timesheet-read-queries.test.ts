import { describe, expect, it, vi } from 'vitest';
import { runConversation } from '@/lib/ai/conversation';
import { AI_TIMESHEET_SYSTEM_PROMPT } from '@/lib/ai/prompt';
import type { GenerateResponseInput } from '@/lib/ai/types';
import {
  bangkokCurrentWeek,
  bangkokLastMonth,
  bangkokLastWeek,
  bangkokThisMonth,
  bangkokToday,
  bangkokYesterday,
} from '@/lib/tools/business/timesheet/bangkok-dates';
import { createToolRegistry } from '@/lib/tools/registry';
import { createGetTimesheetTool } from '@/lib/tools/business/timesheet/get-timesheet';
import { createGetTimesheetRangeTool } from '@/lib/tools/business/timesheet/get-timesheet-range';
import { createContextManager } from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import { createIdentityResolver } from '@/lib/conversation/context/identity-resolver';
import type { DailyTimesheet, TimesheetRange } from '@/lib/tools/business/types';
import type { BusinessToolDeps } from '@/lib/tools/business/helpers';
import type { ConversationIdentity } from '@/lib/tools/business/helpers';

/** Fixed instant: Saturday 2026-07-18 17:00 UTC = Sunday 2026-07-19 morning Bangkok. */
const FIXED_NOW = new Date('2026-07-18T17:00:00.000Z');

const july18Day: DailyTimesheet = {
  date: '2026-07-18',
  entries: [
    {
      clientName: 'Hertz',
      projectName: 'Commerce Suite (HERTZ-PLATFORM-2026-01)',
      roleName: 'Development',
      taskName: 'Development',
      hours: 5,
    },
    {
      clientName: 'Mitrphol',
      projectName:
        'Raw Material Supply Management System (RMS) (MIT-RMS-2025-01)',
      roleName: 'Project Management',
      taskName: 'Project Management',
      hours: 3,
    },
    {
      clientName: 'Shopstack',
      projectName: 'Commerce Suite (SS-COMMERCE-SUTE)',
      roleName: 'Development',
      taskName: 'Development',
      hours: 2,
    },
  ],
  totalHours: 10,
  expectedHours: 8,
  remainingHours: 0,
  submitted: false,
};

function emptyDay(date: string): DailyTimesheet {
  return {
    date,
    entries: [],
    totalHours: 0,
    expectedHours: 8,
    remainingHours: 8,
    submitted: false,
  };
}

function makeDeps(overrides?: {
  readDaily?: BusinessToolDeps['readDailyTimesheet'];
  readRange?: BusinessToolDeps['readTimesheetRange'];
}): BusinessToolDeps {
  const readDailyTimesheet: BusinessToolDeps['readDailyTimesheet'] =
    overrides?.readDaily ??
    (async (_identity: ConversationIdentity, date: string) => {
      if (date === '2026-07-18') return july18Day;
      return emptyDay(date);
    });

  const readTimesheetRange: BusinessToolDeps['readTimesheetRange'] =
    overrides?.readRange ??
    (async (_identity, startDate, endDate) => {
      const days: DailyTimesheet[] = [];
      const start = new Date(`${startDate}T00:00:00.000Z`);
      const end = new Date(`${endDate}T00:00:00.000Z`);
      for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
        const d = new Date(t).toISOString().slice(0, 10);
        days.push(d === '2026-07-18' ? july18Day : emptyDay(d));
      }
      const totalHours = days.reduce((s, d) => s + d.totalHours, 0);
      const expectedHours = days.reduce((s, d) => s + d.expectedHours, 0);
      const range: TimesheetRange = {
        startDate,
        endDate,
        days,
        totalHours,
        expectedHours,
        remainingHours: Math.max(0, expectedHours - totalHours),
        submittedDays: 0,
        unsubmittedDays: days.length,
      };
      return range;
    });

  return {
    readDailyTimesheet,
    readTimesheetRange,
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

function makeRegistry(deps?: BusinessToolDeps) {
  const d = deps ?? makeDeps();
  const registry = createToolRegistry();
  registry.register(createGetTimesheetTool(d));
  registry.register(createGetTimesheetRangeTool(d));
  return registry;
}

function conversationInput(userMessage: string, conversationId: string) {
  return {
    userMessage,
    conversationId,
    requestId: 'r-nl',
    metadata: { slackUserId: 'U1', conversationId },
  };
}

describe('Bangkok date resolution helpers', () => {
  it('resolves today/yesterday/week/month for fixed now', () => {
    expect(bangkokToday(FIXED_NOW)).toBe('2026-07-19');
    expect(bangkokYesterday(FIXED_NOW)).toBe('2026-07-18');
    expect(bangkokCurrentWeek(FIXED_NOW)).toEqual({
      startDate: '2026-07-13',
      endDate: '2026-07-19',
    });
    expect(bangkokLastWeek(FIXED_NOW)).toEqual({
      startDate: '2026-07-06',
      endDate: '2026-07-12',
    });
    expect(bangkokThisMonth(FIXED_NOW)).toEqual({
      startDate: '2026-07-01',
      endDate: '2026-07-19',
    });
    expect(bangkokLastMonth(FIXED_NOW)).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    });
  });
});

describe('AI prompt date rules', () => {
  it('documents get_timesheet / range and Bangkok resolution', () => {
    expect(AI_TIMESHEET_SYSTEM_PROMPT).toContain('get_timesheet');
    expect(AI_TIMESHEET_SYSTEM_PROMPT).toContain('get_timesheet_range');
    expect(AI_TIMESHEET_SYSTEM_PROMPT).toContain('Asia/Bangkok');
    expect(AI_TIMESHEET_SYSTEM_PROMPT).not.toContain('get_today_timesheet');
    expect(AI_TIMESHEET_SYSTEM_PROMPT).not.toContain('get_week_timesheet');
    expect(AI_TIMESHEET_SYSTEM_PROMPT).toMatch(/clarification/i);
    expect(AI_TIMESHEET_SYSTEM_PROMPT).toMatch(
      /Only a successful tool result with zero entries/i
    );
  });
});

describe('AI conversation date → tool calls', () => {
  it('เมื่อวาน + fixture: get_timesheet once with Hertz/Mitrphol/Shopstack 10h', async () => {
    const yesterday = bangkokYesterday(FIXED_NOW);
    expect(yesterday).toBe('2026-07-18');

    let readCalls = 0;
    const deps = makeDeps({
      readDaily: async (identity, date) => {
        readCalls += 1;
        expect(identity.employeeId).toBe('S0005');
        expect(date).toBe('2026-07-18');
        return july18Day;
      },
    });
    const registry = makeRegistry(deps);

    let turn = 0;
    let executedTools: string[] = [];
    const result = await runConversation(
      conversationInput('เมื่อวานฉันทำงานอะไรไปบ้าง', 'conv-nl-july18'),
      {
        toolRegistry: registry,
        decisionNow: FIXED_NOW,
        generate: async (input: GenerateResponseInput) => {
          turn += 1;
          if (turn === 1) {
            // Model omits tool; Decision Engine must force get_timesheet(2026-07-18)
            return { text: '', model: 'm' };
          }
          const toolMsgs = input.messages.filter((m) => m.role === 'tool');
          executedTools = toolMsgs.map((m) => m.name || '');
          expect(toolMsgs).toHaveLength(1);
          expect(toolMsgs[0]?.name).toBe('get_timesheet');
          expect(toolMsgs[0]?.content).toContain('"success":true');
          expect(toolMsgs[0]?.content).toContain('Hertz');
          expect(toolMsgs[0]?.content).toContain('Mitrphol');
          expect(toolMsgs[0]?.content).toContain('Shopstack');
          expect(toolMsgs[0]?.content).toContain('"totalHours":10');
          expect(toolMsgs[0]?.content).not.toMatch(/get_work_context/);
          return {
            text: [
              'เมื่อวาน (2026-07-18) คุณลงเวลา 10 ชั่วโมง:',
              'Hertz / Commerce Suite / Development / 5 hours',
              'Mitrphol / RMS / Project Management / 3 hours',
              'Shopstack / Commerce Suite / Development / 2 hours',
            ].join('\n'),
            model: 'm',
          };
        },
      }
    );

    expect(readCalls).toBe(1);
    expect(executedTools).toEqual(['get_timesheet']);
    expect(result.text).toContain('Hertz');
    expect(result.text).toContain('Mitrphol');
    expect(result.text).toContain('Shopstack');
    expect(result.text).toMatch(/10/);
    expect(result.text).not.toMatch(/No timesheet data exists/i);
    expect(result.toolRounds).toBe(1);
  });

  it.each([
    {
      label: 'today',
      message: 'วันนี้ฉันทำอะไร',
      tool: 'get_timesheet',
      args: () => ({ date: bangkokToday(FIXED_NOW) }),
    },
    {
      label: 'specific ISO',
      message: '2026-07-15 ฉันลงอะไร',
      tool: 'get_timesheet',
      args: () => ({ date: '2026-07-15' }),
    },
    {
      label: 'this week',
      message: 'สัปดาห์นี้ลงกี่ชั่วโมง',
      tool: 'get_timesheet_range',
      args: () => bangkokCurrentWeek(FIXED_NOW),
    },
    {
      label: 'last week',
      message: 'สัปดาห์ที่แล้ว',
      tool: 'get_timesheet_range',
      args: () => bangkokLastWeek(FIXED_NOW),
    },
    {
      label: 'this month',
      message: 'เดือนนี้',
      tool: 'get_timesheet_range',
      args: () => bangkokThisMonth(FIXED_NOW),
    },
    {
      label: 'custom range',
      message: 'จาก 2026-07-01 ถึง 2026-07-10',
      tool: 'get_timesheet_range',
      args: () => ({ startDate: '2026-07-01', endDate: '2026-07-10' }),
    },
  ])(
    'NL $label maps to $tool with resolved ISO args',
    async ({ message, tool, args }) => {
      const resolved = args();
      const registry = makeRegistry();

      let turn = 0;
      let capturedArgs: Record<string, unknown> | undefined;
      const result = await runConversation(
        conversationInput(message, `conv-${tool}-${message.slice(0, 8)}`),
        {
          toolRegistry: registry,
          decisionNow: FIXED_NOW,
          generate: async (input: GenerateResponseInput) => {
            turn += 1;
            if (turn === 1) {
              capturedArgs = resolved as Record<string, unknown>;
              return {
                text: '',
                model: 'm',
                toolCalls: [
                  {
                    id: 'c1',
                    type: 'function' as const,
                    function: {
                      name: tool,
                      arguments: JSON.stringify(resolved),
                    },
                  },
                ],
              };
            }
            expect(input.messages.some((m) => m.role === 'tool')).toBe(true);
            return { text: 'ok', model: 'm' };
          },
        }
      );
      expect(capturedArgs).toEqual(resolved);
      expect(result.toolRounds).toBe(1);
      expect(result.text).toBe('ok');
    }
  );

  it('ambiguous date asks clarification without tool call', async () => {
    const generate = vi.fn(async () => ({
      text: 'should not run',
      model: 'm',
    }));

    const result = await runConversation(
      conversationInput('วันที่ 15 ฉันทำอะไร', 'conv-ambiguous'),
      {
        toolRegistry: createToolRegistry(),
        generate,
        decisionNow: FIXED_NOW,
      }
    );

    expect(generate).not.toHaveBeenCalled();
    expect(result.text).toMatch(/date|month|year|2026/i);
    expect(result.toolRounds ?? 0).toBe(0);
    expect(result.model).toBe('decision-engine');
  });
});

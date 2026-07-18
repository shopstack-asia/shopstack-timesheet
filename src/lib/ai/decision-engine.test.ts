import { describe, expect, it, vi } from 'vitest';
import {
  REQUIRED_TOOL_MISSING_MESSAGE,
  TOOLS_DISABLED_FOR_BUSINESS_MESSAGE,
  enforceRequiredBusinessTool,
  runConversation,
} from '@/lib/ai/conversation';
import { decideBusinessTool } from '@/lib/ai/decision-engine';
import { AI_TIMESHEET_SYSTEM_PROMPT } from '@/lib/ai/prompt';
import type { BusinessApiClient } from '@/lib/business/client';
import { createContextManager } from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import { createIdentityResolver } from '@/lib/conversation/context/identity-resolver';
import { createGetWorkContextTool } from '@/lib/tools/business/context/get-work-context';
import { createGetTimesheetTool } from '@/lib/tools/business/timesheet/get-timesheet';
import { createGetTimesheetRangeTool } from '@/lib/tools/business/timesheet/get-timesheet-range';
import {
  bangkokCurrentWeek,
  bangkokToday,
  bangkokTomorrow,
  bangkokYesterday,
} from '@/lib/tools/business/timesheet/bangkok-dates';
import {
  pingTool,
  currentDateTool,
  currentTimeTool,
} from '@/lib/tools/builtins';
import { createToolRegistry } from '@/lib/tools/registry';
import type { GenerateResponseInput } from '@/lib/ai/types';

const FIXED_NOW = new Date('2026-07-18T17:00:00.000Z'); // Bangkok 2026-07-19

function mockClient(paths: Record<string, unknown>): BusinessApiClient {
  return {
    getConfig: () => ({
      baseUrl: 'https://timesheet-api.test',
      timeoutMs: 5000,
      apiKey: 'k',
      maxRetries: 0,
      logging: false,
    }),
    request: async () => {
      throw new Error('not used');
    },
    get: (async (path: string) => {
      const key = Object.keys(paths).find((k) => path.includes(k)) ?? 'default';
      return {
        success: true as const,
        data: paths[key] ?? paths.default,
        status: 200,
        requestId: 'r1',
      };
    }) as BusinessApiClient['get'],
    post: async () => {
      throw new Error('not used');
    },
    put: async () => {
      throw new Error('not used');
    },
    patch: async () => {
      throw new Error('not used');
    },
    delete: async () => {
      throw new Error('not used');
    },
  };
}

function makeRegistry(client: BusinessApiClient, extras = true) {
  const deps = {
    client,
    contextManager: createContextManager({
      store: createContextStore(),
      identityResolver: createIdentityResolver({
        lookup: async () => ({
          ok: true,
          auth: {
            staff: {
              EmployeeID: 'S1',
              Email: 'ada@shopstack.asia',
            },
          },
        }),
      }),
      businessClient: client,
    }),
  };
  const registry = createToolRegistry();
  if (extras) {
    registry.register(pingTool);
    registry.register(currentDateTool);
    registry.register(currentTimeTool);
  }
  registry.register(createGetWorkContextTool(deps));
  registry.register(createGetTimesheetTool(deps));
  registry.register(createGetTimesheetRangeTool(deps));
  return registry;
}

function input(userMessage: string, conversationId: string) {
  return {
    userMessage,
    conversationId,
    requestId: 'r-decision',
    metadata: { slackUserId: 'U1', conversationId },
  };
}

function dayPayload(date: string) {
  return {
    date,
    entries: [{ hours: 4, description: 'API' }],
    totalHours: 4,
    expectedHours: 8,
    remainingHours: 4,
    submitted: false,
  };
}

describe('decideBusinessTool', () => {
  it('maps work context intents', () => {
    for (const msg of [
      'ฉันมี project อะไรบ้าง',
      'Client ของฉัน',
      'เลือก project',
    ]) {
      const d = decideBusinessTool(msg, { now: FIXED_NOW });
      expect(d.action).toBe('call_tool');
      if (d.action === 'call_tool') {
        expect(d.toolName).toBe('get_work_context');
      }
    }
  });

  it('maps single-day intents', () => {
    const d = decideBusinessTool('เมื่อวานฉันทำอะไร', { now: FIXED_NOW });
    expect(d).toMatchObject({
      action: 'call_tool',
      toolName: 'get_timesheet',
      arguments: { date: bangkokYesterday(FIXED_NOW) },
    });
  });

  it('maps tomorrow / พรุ่งนี้ to Bangkok tomorrow, never today', () => {
    for (const msg of ['tomorrow', 'พรุ่งนี้']) {
      const d = decideBusinessTool(msg, { now: FIXED_NOW });
      expect(d).toMatchObject({
        action: 'call_tool',
        toolName: 'get_timesheet',
        arguments: { date: '2026-07-20' },
      });
      if (d.action === 'call_tool') {
        expect(d.arguments.date).not.toBe(bangkokToday(FIXED_NOW));
        expect(d.arguments.date).toBe(bangkokTomorrow(FIXED_NOW));
      }
    }
  });

  it('resolves tomorrow across month and year boundaries', () => {
    const jan31 = new Date('2026-01-31T05:00:00.000Z'); // Bangkok 2026-01-31
    expect(bangkokTomorrow(jan31)).toBe('2026-02-01');
    expect(decideBusinessTool('tomorrow', { now: jan31 })).toMatchObject({
      action: 'call_tool',
      arguments: { date: '2026-02-01' },
    });

    const dec31 = new Date('2026-12-31T05:00:00.000Z'); // Bangkok 2026-12-31
    expect(bangkokTomorrow(dec31)).toBe('2027-01-01');
    expect(decideBusinessTool('พรุ่งนี้', { now: dec31 })).toMatchObject({
      action: 'call_tool',
      arguments: { date: '2027-01-01' },
    });
  });

  it('maps relative range intents', () => {
    const d = decideBusinessTool('สรุปสัปดาห์นี้', { now: FIXED_NOW });
    expect(d).toMatchObject({
      action: 'call_tool',
      toolName: 'get_timesheet_range',
      arguments: bangkokCurrentWeek(FIXED_NOW),
    });
  });

  it.each([
    ['จาก 2026-07-01 ถึง 2026-07-10'],
    ['ตั้งแต่ 2026-07-01 ถึง 2026-07-10'],
    ['2026-07-01 ถึง 2026-07-10'],
    ['from 2026-07-01 to 2026-07-10'],
    ['between 2026-07-01 and 2026-07-10'],
    ['2026-07-01 - 2026-07-10'],
  ])('explicit range: %s', (msg) => {
    const d = decideBusinessTool(msg, { now: FIXED_NOW });
    expect(d).toEqual({
      action: 'call_tool',
      toolName: 'get_timesheet_range',
      arguments: { startDate: '2026-07-01', endDate: '2026-07-10' },
      reason: 'explicit_date_range',
    });
  });

  it('clarifies invalid / reversed / too-long explicit ranges', () => {
    expect(
      decideBusinessTool('from 2026-02-30 to 2026-03-01', { now: FIXED_NOW })
        .action
    ).toBe('clarify');
    expect(
      decideBusinessTool('from 2026-07-10 to 2026-07-01', { now: FIXED_NOW })
        .action
    ).toBe('clarify');
    expect(
      decideBusinessTool('from 2026-06-01 to 2026-07-10', { now: FIXED_NOW })
        .action
    ).toBe('clarify');
  });

  it('does not convert an explicit range into get_timesheet', () => {
    const d = decideBusinessTool('จาก 2026-07-01 ถึง 2026-07-10', {
      now: FIXED_NOW,
    });
    expect(d.action).toBe('call_tool');
    if (d.action === 'call_tool') {
      expect(d.toolName).toBe('get_timesheet_range');
      expect(d.toolName).not.toBe('get_timesheet');
    }
  });

  it('skips tools for thanks and stories', () => {
    expect(decideBusinessTool('ขอบคุณ', { now: FIXED_NOW }).action).toBe(
      'none'
    );
    expect(
      decideBusinessTool('เล่าเรื่องแมวให้ฟัง', { now: FIXED_NOW }).action
    ).toBe('none');
  });

  it('clarifies ambiguous bare day without LLM', () => {
    const d = decideBusinessTool('วันที่ 15 ฉันทำอะไร', { now: FIXED_NOW });
    expect(d.action).toBe('clarify');
  });
});

describe('enforceRequiredBusinessTool', () => {
  const decision = {
    action: 'call_tool' as const,
    toolName: 'get_timesheet' as const,
    arguments: { date: '2026-07-18' },
    reason: 'timesheet_day_intent',
  };

  it('replaces unrelated tools with the required tool', () => {
    const { toolCalls, enforced } = enforceRequiredBusinessTool(
      [
        {
          id: '1',
          type: 'function',
          function: { name: 'ping', arguments: '{}' },
        },
      ],
      decision
    );
    expect(enforced).toBe(true);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.function.name).toBe('get_timesheet');
    expect(toolCalls[0]?.function.arguments).toBe(
      JSON.stringify({ date: '2026-07-18' })
    );
  });

  it('keeps a single correct tool and overwrites args from the Decision Engine', () => {
    const { toolCalls, enforced } = enforceRequiredBusinessTool(
      [
        {
          id: 'c1',
          type: 'function',
          function: {
            name: 'get_timesheet',
            arguments: JSON.stringify({ date: '1999-01-01' }),
          },
        },
      ],
      decision
    );
    expect(enforced).toBe(false);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.id).toBe('c1');
    expect(toolCalls[0]?.function.arguments).toBe(
      JSON.stringify({ date: '2026-07-18' })
    );
  });
});

describe('prompt reliability rules', () => {
  it('forbids answering business data from model knowledge', () => {
    expect(AI_TIMESHEET_SYSTEM_PROMPT).toContain(
      'Business Tools are the source of truth'
    );
    expect(AI_TIMESHEET_SYSTEM_PROMPT).toContain(
      'Always attempt tool execution first'
    );
    expect(AI_TIMESHEET_SYSTEM_PROMPT).toContain('Never fabricate');
  });
});

describe('AI conversation tool selection reliability', () => {
  it('ฉันมี project อะไรบ้าง forces get_work_context when model skips', async () => {
    const client = mockClient({
      'work-context': {
        user: { id: 'S1', name: 'Ada' },
        clients: [
          {
            id: 'c1',
            name: 'Acme',
            projects: [
              {
                id: 'p1',
                name: 'Portal',
                roles: [{ id: 'r1', name: 'Dev' }],
              },
            ],
          },
        ],
      },
    });
    const registry = makeRegistry(client);
    const executed: string[] = [];
    let turn = 0;

    const result = await runConversation(
      input('ฉันมี project อะไรบ้าง', 'conv-wc'),
      {
        toolRegistry: registry,
        decisionNow: FIXED_NOW,
        generate: async (req: GenerateResponseInput) => {
          turn += 1;
          if (turn === 1) {
            return {
              text: 'I cannot access your projects.',
              model: 'm',
            };
          }
          const toolMsg = req.messages.find((m) => m.role === 'tool');
          expect(toolMsg?.name).toBe('get_work_context');
          executed.push(toolMsg!.name!);
          return { text: 'You have project Portal under Acme.', model: 'm' };
        },
      }
    );

    expect(executed).toEqual(['get_work_context']);
    expect(result.text).toContain('Portal');
    expect(result.text).not.toMatch(/cannot access/i);
  });

  it.each([
    ['จาก 2026-07-01 ถึง 2026-07-10'],
    ['ตั้งแต่ 2026-07-01 ถึง 2026-07-10'],
    ['from 2026-07-01 to 2026-07-10'],
    ['between 2026-07-01 and 2026-07-10'],
    ['2026-07-01 - 2026-07-10'],
  ])(
    'explicit range forces get_timesheet_range when model skips: %s',
    async (msg) => {
      const client = mockClient({
        timesheets: {
          days: [],
          totalHours: 0,
          expectedHours: 0,
          remainingHours: 0,
          submittedDays: 0,
          unsubmittedDays: 0,
        },
      });
      const registry = makeRegistry(client);
      const executedArgs: string[] = [];
      let turn = 0;

      const result = await runConversation(input(msg, `conv-range-${msg}`), {
        toolRegistry: registry,
        decisionNow: FIXED_NOW,
        generate: async (req: GenerateResponseInput) => {
          turn += 1;
          if (turn === 1) {
            return {
              text: 'I cannot access your timesheet.',
              model: 'm',
            };
          }
          const toolMsg = req.messages.find((m) => m.role === 'tool');
          expect(toolMsg?.name).toBe('get_timesheet_range');
          executedArgs.push(toolMsg!.content!);
          return { text: 'Range summary: 0 hours.', model: 'm' };
        },
      });

      expect(executedArgs).toHaveLength(1);
      expect(executedArgs[0]).toContain('2026-07-01');
      expect(executedArgs[0]).toContain('2026-07-10');
      expect(result.text).toContain('Range summary');
      expect(result.text).not.toMatch(/cannot access/i);
    }
  );

  it.each([
    ['ping'],
    ['current_date'],
    ['get_work_context'],
    [null],
  ] as const)(
    'เมื่อวาน: wrong round-0 tool %s is replaced by get_timesheet once',
    async (wrongTool) => {
      const yesterday = bangkokYesterday(FIXED_NOW);
      const client = mockClient({ timesheets: dayPayload(yesterday) });
      const registry = makeRegistry(client);
      const executed: string[] = [];
      let turn = 0;

      const result = await runConversation(
        input('เมื่อวานฉันทำอะไร', `conv-wrong-${wrongTool ?? 'none'}`),
        {
          toolRegistry: registry,
          decisionNow: FIXED_NOW,
          generate: async (req: GenerateResponseInput) => {
            turn += 1;
            if (turn === 1) {
              if (!wrongTool) {
                return { text: 'I cannot access your timesheet.', model: 'm' };
              }
              return {
                text: '',
                model: 'm',
                toolCalls: [
                  {
                    id: 'wrong1',
                    type: 'function' as const,
                    function: {
                      name: wrongTool,
                      arguments: '{}',
                    },
                  },
                ],
              };
            }
            const toolMsgs = req.messages.filter((m) => m.role === 'tool');
            expect(toolMsgs).toHaveLength(1);
            expect(toolMsgs[0]?.name).toBe('get_timesheet');
            expect(toolMsgs[0]?.content).toContain(yesterday);
            expect(toolMsgs[0]?.content).not.toContain('ping');
            executed.push(toolMsgs[0]!.name!);
            return {
              text: `Yesterday you logged 4 hours on ${yesterday}.`,
              model: 'm',
            };
          },
        }
      );

      expect(executed).toEqual(['get_timesheet']);
      expect(result.toolRounds).toBe(1);
      expect(result.text).toContain(yesterday);
      expect(result.text).not.toMatch(/cannot access/i);
    }
  );

  it('does not duplicate get_timesheet when the model already called it', async () => {
    const yesterday = bangkokYesterday(FIXED_NOW);
    const client = mockClient({ timesheets: dayPayload(yesterday) });
    const timesheet = createGetTimesheetTool({
      client,
      contextManager: createContextManager({
        store: createContextStore(),
        identityResolver: createIdentityResolver({
          lookup: async () => ({
            ok: true,
            auth: {
              staff: {
                EmployeeID: 'S1',
                Email: 'ada@shopstack.asia',
              },
            },
          }),
        }),
        businessClient: client,
      }),
    });
    let executeCount = 0;
    const wrapped = {
      ...timesheet,
      async execute(
        args: Record<string, unknown>,
        ctx: Parameters<typeof timesheet.execute>[1]
      ) {
        executeCount += 1;
        return timesheet.execute(args, ctx);
      },
    };
    const reg = createToolRegistry();
    reg.register(wrapped);

    let turn = 0;
    await runConversation(input('เมื่อวานฉันทำอะไร', 'conv-dup'), {
      toolRegistry: reg,
      decisionNow: FIXED_NOW,
      generate: async (req: GenerateResponseInput) => {
        turn += 1;
        if (turn === 1) {
          return {
            text: '',
            model: 'm',
            toolCalls: [
              {
                id: 'c1',
                type: 'function' as const,
                function: {
                  name: 'get_timesheet',
                  arguments: JSON.stringify({ date: '1999-01-01' }),
                },
              },
            ],
          };
        }
        const toolMsgs = req.messages.filter((m) => m.role === 'tool');
        expect(toolMsgs).toHaveLength(1);
        expect(toolMsgs[0]?.content).toContain(yesterday);
        expect(toolMsgs[0]?.content).not.toContain('1999-01-01');
        return { text: 'ok', model: 'm' };
      },
    });

    expect(executeCount).toBe(1);
  });

  it('required tool missing from registry → controlled error', async () => {
    const generate = vi.fn(async () => ({
      text: 'You logged 8 hours yesterday.',
      model: 'm',
    }));
    const result = await runConversation(
      input('เมื่อวานฉันทำอะไร', 'conv-missing'),
      {
        toolRegistry: createToolRegistry(),
        decisionNow: FIXED_NOW,
        generate,
      }
    );
    expect(generate).not.toHaveBeenCalled();
    expect(result.text).toBe(REQUIRED_TOOL_MISSING_MESSAGE);
    expect(result.text).not.toMatch(/logged 8 hours/i);
  });

  it('business intent with enableTools false → controlled error', async () => {
    const generate = vi.fn(async () => ({
      text: 'You logged 8 hours yesterday.',
      model: 'm',
    }));
    const result = await runConversation(
      input('เมื่อวานฉันทำอะไร', 'conv-disabled'),
      {
        enableTools: false,
        decisionNow: FIXED_NOW,
        generate,
      }
    );
    expect(generate).not.toHaveBeenCalled();
    expect(result.text).toBe(TOOLS_DISABLED_FOR_BUSINESS_MESSAGE);
  });

  it('สรุปสัปดาห์นี้ forces get_timesheet_range when model skips', async () => {
    const week = bangkokCurrentWeek(FIXED_NOW);
    const client = mockClient({
      timesheets: {
        days: [],
        totalHours: 0,
        expectedHours: 0,
        remainingHours: 0,
        submittedDays: 0,
        unsubmittedDays: 0,
      },
    });
    const registry = makeRegistry(client);
    let turn = 0;

    const result = await runConversation(input('สรุปสัปดาห์นี้', 'conv-week'), {
      toolRegistry: registry,
      decisionNow: FIXED_NOW,
      generate: async (req: GenerateResponseInput) => {
        turn += 1;
        if (turn === 1) {
          return { text: 'It seems I cannot retrieve your work.', model: 'm' };
        }
        const toolMsg = req.messages.find((m) => m.role === 'tool');
        expect(toolMsg?.name).toBe('get_timesheet_range');
        expect(toolMsg?.content).toContain(week.startDate);
        return { text: 'Weekly total: 0 hours.', model: 'm' };
      },
    });
    expect(result.text).toContain('Weekly total');
  });

  it('ขอบคุณ calls no tool', async () => {
    const route = vi.fn();
    const result = await runConversation(input('ขอบคุณ', 'conv-thanks'), {
      decisionNow: FIXED_NOW,
      toolRegistry: createToolRegistry(),
      toolRouter: { route } as never,
      generate: async () => ({ text: 'ยินดีครับ', model: 'm' }),
    });
    expect(route).not.toHaveBeenCalled();
    expect(result.toolRounds).toBe(0);
  });

  it('เล่าเรื่องแมวให้ฟัง calls no tool', async () => {
    const route = vi.fn();
    const result = await runConversation(
      input('เล่าเรื่องแมวให้ฟัง', 'conv-cat'),
      {
        decisionNow: FIXED_NOW,
        toolRegistry: createToolRegistry(),
        toolRouter: { route } as never,
        generate: async () => ({
          text: 'Once upon a time there was a cat.',
          model: 'm',
        }),
      }
    );
    expect(route).not.toHaveBeenCalled();
    expect(result.toolRounds).toBe(0);
  });
});

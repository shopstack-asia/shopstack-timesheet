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

const WORK_CONTEXT_PAYLOAD = {
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
};

describe('fail-closed potential work-context intents', () => {
  it.each([
    'What am I currently working on?',
    'Show my assignments',
    'Which accounts am I assigned to?',
    'What work am I responsible for?',
    'What am I assigned to?',
    'ตอนนี้ฉันรับผิดชอบงานอะไรอยู่',
    'ฉันได้รับมอบหมายงานอะไรบ้าง',
    'ตอนนี้ฉันทำงานอะไรอยู่',
    'ฉันดูแลงานอะไรบ้าง',
    'ฉันอยู่ account ไหนบ้าง',
  ])('routes to get_work_context: %s', (msg) => {
    expect(decideBusinessTool(msg, { now: FIXED_NOW })).toMatchObject({
      action: 'call_tool',
      toolName: 'get_work_context',
      arguments: {},
    });
  });

  it('forces get_work_context when model says it cannot access assignments', async () => {
    const registry = makeRegistry(mockClient(WORK_CONTEXT_PAYLOAD));
    const executed: string[] = [];
    let turn = 0;

    const result = await runConversation(
      input('What am I currently working on?', 'conv-assign'),
      {
        toolRegistry: registry,
        decisionNow: FIXED_NOW,
        generate: async (req: GenerateResponseInput) => {
          turn += 1;
          if (turn === 1) {
            return {
              text: 'I cannot access your assignments.',
              model: 'm',
            };
          }
          const toolMsgs = req.messages.filter((m) => m.role === 'tool');
          expect(toolMsgs).toHaveLength(1);
          expect(toolMsgs[0]?.name).toBe('get_work_context');
          executed.push(toolMsgs[0]!.name!);
          expect(toolMsgs[0]?.content).toContain('Portal');
          return {
            text: 'You are assigned to Portal under Acme.',
            model: 'm',
          };
        },
      }
    );

    expect(executed).toEqual(['get_work_context']);
    expect(result.text).toContain('Portal');
    expect(result.text).not.toMatch(/cannot access/i);
  });

  it.each([['ping'], ['current_date'], ['get_timesheet']] as const)(
    'replaces wrong tool %s with get_work_context for assignment ask',
    async (wrongTool) => {
      const registry = makeRegistry(mockClient(WORK_CONTEXT_PAYLOAD));
      const executed: string[] = [];
      let turn = 0;

      await runConversation(
        input('Show my assignments', `conv-wrong-wc-${wrongTool}`),
        {
          toolRegistry: registry,
          decisionNow: FIXED_NOW,
          generate: async (req: GenerateResponseInput) => {
            turn += 1;
            if (turn === 1) {
              return {
                text: '',
                model: 'm',
                toolCalls: [
                  {
                    id: 'w1',
                    type: 'function' as const,
                    function: {
                      name: wrongTool,
                      arguments:
                        wrongTool === 'get_timesheet'
                          ? JSON.stringify({ date: '2026-07-18' })
                          : '{}',
                    },
                  },
                ],
              };
            }
            const toolMsgs = req.messages.filter((m) => m.role === 'tool');
            expect(toolMsgs).toHaveLength(1);
            expect(toolMsgs[0]?.name).toBe('get_work_context');
            executed.push(toolMsgs[0]!.name!);
            return { text: 'Assignments loaded.', model: 'm' };
          },
        }
      );

      expect(executed).toEqual(['get_work_context']);
    }
  );
});

describe('missing timesheet period clarification', () => {
  it.each([
    'Show my timesheet',
    'How many hours did I log?',
    'ฉันลงเวลาไปกี่ชั่วโมง',
    'ดู timesheet ของฉัน',
  ])('clarifies without LLM/tool: %s', async (msg) => {
    const d = decideBusinessTool(msg, { now: FIXED_NOW });
    expect(d.action).toBe('clarify');
    if (d.action === 'clarify') {
      expect(d.reason).toBe('missing_timesheet_period');
      expect(d.message).toMatch(/date/i);
    }

    const generate = vi.fn();
    const route = vi.fn();
    const result = await runConversation(input(msg, `conv-clarify-${msg}`), {
      decisionNow: FIXED_NOW,
      toolRegistry: createToolRegistry(),
      toolRouter: { route } as never,
      generate,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(route).not.toHaveBeenCalled();
    expect(result.model).toBe('decision-engine');
    expect(result.text).toMatch(/date/i);
  });
});

describe('general conversation regressions', () => {
  it.each([
    'What is a timesheet?',
    'What is project management?',
    'Explain microservice architecture',
    'How do I write TypeScript?',
    'เล่าเรื่องการทำงานของโปรแกรมให้ฟัง',
  ])('stays none: %s', (msg) => {
    expect(decideBusinessTool(msg, { now: FIXED_NOW })).toMatchObject({
      action: 'none',
      reason: 'general_conversation',
    });
  });

  it('date range with project word still uses get_timesheet_range', () => {
    const d = decideBusinessTool(
      'Show my work on project Portal from 2026-07-01 to 2026-07-10',
      { now: FIXED_NOW }
    );
    expect(d).toMatchObject({
      action: 'call_tool',
      toolName: 'get_timesheet_range',
      arguments: { startDate: '2026-07-01', endDate: '2026-07-10' },
    });
  });
});

describe('standalone relative dates → get_timesheet', () => {
  it.each([
    ['today', '2026-07-19'],
    ['วันนี้', '2026-07-19'],
    ['yesterday', '2026-07-18'],
    ['เมื่อวาน', '2026-07-18'],
    ['tomorrow', '2026-07-20'],
    ['พรุ่งนี้', '2026-07-20'],
  ] as const)('%s → get_timesheet(%s)', (msg, date) => {
    const d = decideBusinessTool(msg, { now: FIXED_NOW });
    expect(d).toMatchObject({
      action: 'call_tool',
      toolName: 'get_timesheet',
      arguments: { date },
    });
    expect(d).not.toMatchObject({ toolName: 'get_work_context' });
  });

  it('month / year boundaries for tomorrow', () => {
    const jan31 = new Date('2026-01-31T05:00:00.000Z');
    expect(decideBusinessTool('today', { now: jan31 })).toMatchObject({
      arguments: { date: '2026-01-31' },
    });
    expect(decideBusinessTool('tomorrow', { now: jan31 })).toMatchObject({
      arguments: { date: '2026-02-01' },
    });
    const dec31 = new Date('2026-12-31T05:00:00.000Z');
    expect(decideBusinessTool('พรุ่งนี้', { now: dec31 })).toMatchObject({
      arguments: { date: '2027-01-01' },
    });
  });
});

describe('general project/work questions stay none', () => {
  it.each([
    'How do I manage a software project?',
    'Compare project management methodologies',
    'Tell me about project management',
    'Explain project management',
    'What is project management?',
    'What does a project manager do?',
    'What is a client account?',
    'What is a role in project management?',
    'How does a timesheet system work?',
    'What is an employee timesheet?',
  ])('%s', (msg) => {
    expect(decideBusinessTool(msg, { now: FIXED_NOW })).toMatchObject({
      action: 'none',
      reason: 'general_conversation',
    });
  });
});

describe('general date/news/weather questions stay none', () => {
  it.each([
    "Tell me about yesterday's news",
    "Summarize today's news",
    'What happened yesterday?',
    'What is the weather today?',
    'Will it rain tomorrow?',
    "Summarize this week's technology news",
    'What events are happening today?',
    'What day is today?',
    'สรุปข่าววันนี้',
    'เมื่อวานมีข่าวอะไรบ้าง',
    'พรุ่งนี้ฝนตกไหม',
    'อากาศวันนี้เป็นอย่างไร',
    'สรุปข่าวเทคโนโลยีสัปดาห์นี้',
    'วันนี้มีเหตุการณ์อะไร',
    'เดือนนี้มีวันหยุดอะไรบ้าง',
  ])('%s', (msg) => {
    expect(decideBusinessTool(msg, { now: FIXED_NOW })).toMatchObject({
      action: 'none',
      reason: 'general_conversation',
    });
  });
});

describe('general programming with business vocabulary stays none', () => {
  it.each([
    'How do I design a project API?',
    'Show me a timesheet database schema',
    'Write code to calculate working hours',
    'How should a project service be structured?',
    'Explain timesheet architecture',
    'How do I test a client API?',
    'ช่วยออกแบบ Timesheet Database Schema',
    'เขียนโค้ดคำนวณชั่วโมงทำงาน',
    'ออกแบบ Project API อย่างไร',
    'อธิบาย Timesheet Architecture',
  ])('%s', (msg) => {
    expect(decideBusinessTool(msg, { now: FIXED_NOW }).action).toBe('none');
  });
});

describe('range keyword regressions', () => {
  it.each([
    'Summarize this',
    'สรุปให้หน่อย',
    "Summarize today's news",
    'สรุปข่าววันนี้',
  ])('unqualified/news summary → none: %s', (msg) => {
    expect(decideBusinessTool(msg, { now: FIXED_NOW }).action).toBe('none');
  });

  it.each([
    ['Summary for this week', bangkokCurrentWeek(FIXED_NOW)],
    ['สรุป Timesheet สัปดาห์นี้', bangkokCurrentWeek(FIXED_NOW)],
  ] as const)('qualified timesheet summary → range: %s', (msg, range) => {
    expect(decideBusinessTool(msg, { now: FIXED_NOW })).toMatchObject({
      action: 'call_tool',
      toolName: 'get_timesheet_range',
      arguments: range,
    });
  });
});

describe('employee timesheet phrasing', () => {
  it.each([
    ['Show my timesheet today', bangkokToday(FIXED_NOW)],
    ['What did I log yesterday?', bangkokYesterday(FIXED_NOW)],
    ['วันนี้ฉันทำอะไร', bangkokToday(FIXED_NOW)],
    ['เมื่อวานฉันลงอะไร', bangkokYesterday(FIXED_NOW)],
  ] as const)('%s → get_timesheet', (msg, date) => {
    expect(decideBusinessTool(msg, { now: FIXED_NOW })).toMatchObject({
      action: 'call_tool',
      toolName: 'get_timesheet',
      arguments: { date },
    });
  });

  it('สัปดาห์นี้ฉันลงไปกี่ชั่วโมง → get_timesheet_range', () => {
    expect(
      decideBusinessTool('สัปดาห์นี้ฉันลงไปกี่ชั่วโมง', { now: FIXED_NOW })
    ).toMatchObject({
      action: 'call_tool',
      toolName: 'get_timesheet_range',
      arguments: bangkokCurrentWeek(FIXED_NOW),
    });
  });
});

describe('runConversation general requests never hit tools', () => {
  it.each([
    'How do I manage a software project?',
    'Explain microservice architecture',
    "Tell me about yesterday's news",
    'สรุปข่าววันนี้',
    'Will it rain tomorrow?',
  ])('%s → no Business Tool', async (msg) => {
    const route = vi.fn();
    const result = await runConversation(input(msg, `conv-gen-${msg.slice(0, 12)}`), {
      decisionNow: FIXED_NOW,
      toolRegistry: createToolRegistry(),
      toolRouter: { route } as never,
      generate: async () => ({
        text: 'Here is a general answer.',
        model: 'm',
      }),
    });
    expect(route).not.toHaveBeenCalled();
    expect(result.toolRounds).toBe(0);
    expect(result.text).toContain('general answer');
  });
});

describe('runConversation standalone today forces get_timesheet', () => {
  it.each([
    ['today', bangkokToday(FIXED_NOW)],
    ['วันนี้', bangkokToday(FIXED_NOW)],
  ] as const)('%s', async (msg, date) => {
    const client = mockClient({ timesheets: dayPayload(date) });
    const registry = makeRegistry(client);
    const executed: string[] = [];
    let turn = 0;

    const result = await runConversation(input(msg, `conv-today-${msg}`), {
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
        const toolMsgs = req.messages.filter((m) => m.role === 'tool');
        expect(toolMsgs).toHaveLength(1);
        expect(toolMsgs[0]?.name).toBe('get_timesheet');
        expect(toolMsgs[0]?.content).toContain(date);
        executed.push(toolMsgs[0]!.name!);
        return { text: `Logged hours for ${date}.`, model: 'm' };
      },
    });

    expect(executed).toEqual(['get_timesheet']);
    expect(result.text).toContain(date);
    expect(result.text).not.toMatch(/cannot access/i);
  });
});

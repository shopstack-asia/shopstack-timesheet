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
import type { BusinessApiClient } from '@/lib/business/client';
import { createContextManager } from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import { createIdentityResolver } from '@/lib/conversation/context/identity-resolver';

/** Fixed instant: Saturday 2026-07-18 17:00 UTC = Sunday 2026-07-19 morning Bangkok. */
const FIXED_NOW = new Date('2026-07-18T17:00:00.000Z');

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
  });
});

function mockClientReturning(data: unknown): BusinessApiClient {
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
    get: (async () => ({
      success: true as const,
      data,
      status: 200,
      requestId: 'r1',
    })) as BusinessApiClient['get'],
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

function makeRegistry(client: BusinessApiClient) {
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
  registry.register(createGetTimesheetTool(deps));
  registry.register(createGetTimesheetRangeTool(deps));
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

describe('AI conversation date → tool calls', () => {
  it('เมื่อวาน resolves to get_timesheet with Bangkok yesterday', async () => {
    const yesterday = bangkokYesterday(FIXED_NOW);
    const client = mockClientReturning({
      date: yesterday,
      entries: [],
      totalHours: 0,
      expectedHours: 8,
      remainingHours: 8,
      submitted: false,
    });
    const registry = makeRegistry(client);

    let turn = 0;
    let capturedArgs: Record<string, unknown> | undefined;
    const result = await runConversation(conversationInput('เมื่อวานฉันทำงานอะไรไปบ้าง', 'conv-nl-1'), {
      toolRegistry: registry,
      generate: async (input: GenerateResponseInput) => {
        turn += 1;
        if (turn === 1) {
          capturedArgs = { date: yesterday };
          return {
            text: '',
            model: 'm',
            toolCalls: [
              {
                id: 'c1',
                type: 'function' as const,
                function: {
                  name: 'get_timesheet',
                  arguments: JSON.stringify({ date: yesterday }),
                },
              },
            ],
          };
        }
        const toolMsg = input.messages.find((m) => m.role === 'tool');
        expect(toolMsg?.content).toContain('"success":true');
        expect(toolMsg?.content).toContain(yesterday);
        return {
          text: 'เมื่อวานคุณยังไม่ได้ลงเวลา',
          model: 'm',
        };
      },
    });

    expect(capturedArgs).toEqual({
      date: '2026-07-18',
    });
    expect(result.text).toContain('เมื่อวาน');
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
      const client = mockClientReturning(
        tool === 'get_timesheet'
          ? {
              date: (resolved as { date: string }).date,
              entries: [],
              totalHours: 0,
              expectedHours: 8,
              remainingHours: 8,
              submitted: false,
            }
          : {
              days: [],
              totalHours: 0,
              expectedHours: 0,
              remainingHours: 0,
              submittedDays: 0,
              unsubmittedDays: 0,
            }
      );
      const registry = makeRegistry(client);

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

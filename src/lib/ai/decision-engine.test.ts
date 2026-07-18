import { describe, expect, it, vi } from 'vitest';
import { runConversation } from '@/lib/ai/conversation';
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
  bangkokYesterday,
} from '@/lib/tools/business/timesheet/bangkok-dates';
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

  it('maps range intents', () => {
    const d = decideBusinessTool('สรุปสัปดาห์นี้', { now: FIXED_NOW });
    expect(d).toMatchObject({
      action: 'call_tool',
      toolName: 'get_timesheet_range',
      arguments: bangkokCurrentWeek(FIXED_NOW),
    });
  });

  it('skips tools for thanks and stories', () => {
    expect(decideBusinessTool('ขอบคุณ', { now: FIXED_NOW }).action).toBe(
      'none'
    );
    expect(
      decideBusinessTool('เล่าเรื่องแมวให้ฟัง', { now: FIXED_NOW }).action
    ).toBe('none');
  });

  it('clarifies ambiguous bare day', () => {
    const d = decideBusinessTool('วันที่ 15 ฉันทำอะไร', { now: FIXED_NOW });
    expect(d.action).toBe('clarify');
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
  it('ฉันมี project อะไรบ้าง ALWAYS calls get_work_context (even if model skips)', async () => {
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
            // Model wrongly answers without tools — decision engine must force.
            return {
              text: 'I cannot access your projects.',
              model: 'm',
            };
          }
          const toolMsg = req.messages.find((m) => m.role === 'tool');
          expect(toolMsg?.name).toBe('get_work_context');
          executed.push(toolMsg!.name!);
          expect(toolMsg?.content).toContain('"success":true');
          return { text: 'You have project Portal under Acme.', model: 'm' };
        },
      }
    );

    expect(executed).toEqual(['get_work_context']);
    expect(result.toolRounds).toBe(1);
    expect(result.text).toContain('Portal');
    expect(result.text).not.toMatch(/cannot access/i);
  });

  it('เมื่อวานฉันทำอะไร ALWAYS calls get_timesheet', async () => {
    const yesterday = bangkokYesterday(FIXED_NOW);
    const client = mockClient({
      timesheets: {
        date: yesterday,
        entries: [{ hours: 4, description: 'API' }],
        totalHours: 4,
        expectedHours: 8,
        remainingHours: 4,
        submitted: false,
      },
    });
    const registry = makeRegistry(client);
    const executed: string[] = [];
    let turn = 0;

    await runConversation(input('เมื่อวานฉันทำอะไร', 'conv-day'), {
      toolRegistry: registry,
      decisionNow: FIXED_NOW,
      generate: async (req: GenerateResponseInput) => {
        turn += 1;
        if (turn === 1) {
          return { text: 'I do not know.', model: 'm' };
        }
        const toolMsg = req.messages.find((m) => m.role === 'tool');
        expect(toolMsg?.name).toBe('get_timesheet');
        executed.push(toolMsg!.name!);
        expect(toolMsg?.content).toContain(yesterday);
        return { text: `Yesterday you logged 4 hours on ${yesterday}.`, model: 'm' };
      },
    });

    expect(executed).toEqual(['get_timesheet']);
  });

  it('สรุปสัปดาห์นี้ ALWAYS calls get_timesheet_range', async () => {
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
    const executed: string[] = [];
    let turn = 0;

    await runConversation(input('สรุปสัปดาห์นี้', 'conv-week'), {
      toolRegistry: registry,
      decisionNow: FIXED_NOW,
      generate: async (req: GenerateResponseInput) => {
        turn += 1;
        if (turn === 1) {
          return { text: 'It seems I cannot retrieve your work.', model: 'm' };
        }
        const toolMsg = req.messages.find((m) => m.role === 'tool');
        expect(toolMsg?.name).toBe('get_timesheet_range');
        executed.push(toolMsg!.name!);
        expect(toolMsg?.content).toContain(week.startDate);
        return { text: 'Weekly total: 0 hours.', model: 'm' };
      },
    });

    expect(executed).toEqual(['get_timesheet_range']);
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
    expect(result.text).toContain('ยินดี');
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runConversation } from '@/lib/ai/conversation';
import { decideWithIntentViaRegexForTests } from '@/lib/ai/intent/test-regex-decide';
import { AI_TIMESHEET_SYSTEM_PROMPT } from '@/lib/ai/prompt';
import type { GenerateResponseInput } from '@/lib/ai/types';
import { createContextManager } from '@/lib/conversation/context/context-manager';
import { createContextStore } from '@/lib/conversation/context/context-store';
import { createIdentityResolver } from '@/lib/conversation/context/identity-resolver';
import { sendMessage, type SlackPostMessageClient } from '@/lib/slack/responses';
import { normalizeSlackMrkdwn } from '@/lib/slack/mrkdwn';
import { createToolRegistry } from '@/lib/tools/registry';
import { createGetTimesheetTool } from '@/lib/tools/business/timesheet/get-timesheet';
import { createGetTimesheetRangeTool } from '@/lib/tools/business/timesheet/get-timesheet-range';
import type { DailyTimesheet, TimesheetRange } from '@/lib/tools/business/types';
import { mapTimeLogRowToEntry } from '@/lib/timesheet/canonical-read';
import type { TimeLogRow } from '@/types';

const FIXED_NOW = new Date('2026-07-18T17:00:00.000Z');

/** Test-only: legacy regex decide — not production NL routing. */
async function runConversationForTest(
  input: Parameters<typeof runConversation>[0],
  deps?: Parameters<typeof runConversation>[1]
) {
  return runConversation(input, {
    ...deps,
    decideWithIntent: deps?.decideWithIntent ?? decideWithIntentViaRegexForTests,
  });
}

const july18: DailyTimesheet = {
  date: '2026-07-18',
  entries: [
    {
      clientName: 'Hertz',
      projectName: 'Commerce Suite (HERTZ-PLATFORM-2026-01)',
      taskName: 'Development',
      taskId: '3',
      hours: 5,
    },
    {
      clientName: 'Mitrphol',
      projectName:
        'Raw Material Supply Management System (RMS) (MIT-RMS-2025-01)',
      taskName: 'Project Management',
      taskId: '5',
      hours: 3,
    },
    {
      clientName: 'Shopstack',
      projectName: 'Commerce Suite (SS-COMMERCE-SUTE)',
      taskName: 'Development',
      taskId: '3',
      hours: 2,
    },
  ],
  totalHours: 10,
  expectedHours: 8,
  remainingHours: 0,
  submitted: false,
};

function makeDeps(day: DailyTimesheet = july18) {
  return {
    readDailyTimesheet: async () => day,
    readTimesheetRange: async (
      _id: unknown,
      startDate: string,
      endDate: string
    ): Promise<TimesheetRange> => ({
      startDate,
      endDate,
      days: [day],
      totalHours: day.totalHours,
      expectedHours: day.expectedHours,
      remainingHours: day.remainingHours,
      submittedDays: 0,
      unsubmittedDays: 1,
    }),
    contextManager: createContextManager({
      store: createContextStore(),
      identityResolver: createIdentityResolver({
        lookup: async () => ({
          ok: true,
          auth: {
            staff: {
              EmployeeID: 'S0005',
              Email: 'prakasit@shopstack.asia',
            },
          },
        }),
      }),
    }),
  };
}

function assertGroundedInTool(text: string, day: DailyTimesheet): void {
  expect(text).toContain(String(day.totalHours));
  for (const e of day.entries) {
    if (e.clientName) expect(text).toContain(e.clientName);
    if (e.taskName) expect(text).toContain(e.taskName);
    expect(text).toContain(String(e.hours));
  }
}

function assertPresentationStyle(text: string): void {
  expect(text).not.toContain('**');
  expect(text).not.toContain('บทบาท');
  expect(text).not.toContain('get_timesheet');
  expect(text).not.toMatch(/employeeId|"S0005"/);
  expect(text).not.toContain('remainingHours');
  expect(text).not.toMatch(/เวลาที่คาดหวัง|expectedHours/i);
}

describe('Slack response style prompt', () => {
  it('documents Slack mrkdwn and compact timesheet style', () => {
    expect(AI_TIMESHEET_SYSTEM_PROMPT).toContain('Slack Response Style');
    expect(AI_TIMESHEET_SYSTEM_PROMPT).toContain('*single asterisks*');
    expect(AI_TIMESHEET_SYSTEM_PROMPT).toContain('never call it บทบาท');
    expect(AI_TIMESHEET_SYSTEM_PROMPT).toContain(
      'expectedHours / remainingHours / submitted only when'
    );
  });
});

describe('Thai / English daily response contracts', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('Thai เมื่อวานฉันทำอะไร — compact style without expected hours', async () => {
    const deps = makeDeps();
    const registry = createToolRegistry();
    registry.register(createGetTimesheetTool(deps));

    const thaiReply = [
      'เมื่อวานคุณลงเวลาไว้ทั้งหมด *10 ชั่วโมง* ครับ',
      '',
      '• *Hertz* — Commerce Suite: Development 5 ชั่วโมง',
      '• *Mitrphol* — RMS: Project Management 3 ชั่วโมง',
      '• *Shopstack* — Commerce Suite: Development 2 ชั่วโมง',
    ].join('\n');

    let turn = 0;
    const result = await runConversationForTest(
      {
        userMessage: 'เมื่อวานฉันทำอะไร',
        conversationId: 'conv-style-th',
        requestId: 'r-style-th',
        metadata: { slackUserId: 'U1', conversationId: 'conv-style-th' },
      },
      {
        toolRegistry: registry,
        decisionNow: FIXED_NOW,
        generate: async (input: GenerateResponseInput) => {
          turn += 1;
          if (turn === 1) return { text: '', model: 'm' };
          expect(input.messages.some((m) => m.role === 'tool')).toBe(true);
          return { text: thaiReply, model: 'm' };
        },
      }
    );

    const text = normalizeSlackMrkdwn(result.text);
    expect(text).toContain('10 ชั่วโมง');
    expect(text).toContain('Hertz');
    expect(text).toContain('Mitrphol');
    expect(text).toContain('Shopstack');
    expect(text).toContain('Development');
    expect(text).toContain('Project Management');
    expect(text).toContain('•');
    assertPresentationStyle(text);
    assertGroundedInTool(text, july18);
  });

  it('English What did I do yesterday?', async () => {
    const deps = makeDeps();
    const registry = createToolRegistry();
    registry.register(createGetTimesheetTool(deps));

    const englishReply = [
      'You logged *10 hours* yesterday.',
      '',
      '• *Hertz* — Commerce Suite: Development, 5 hours',
      '• *Mitrphol* — RMS: Project Management, 3 hours',
      '• *Shopstack* — Commerce Suite: Development, 2 hours',
    ].join('\n');

    let turn = 0;
    const result = await runConversationForTest(
      {
        userMessage: 'What did I do yesterday?',
        conversationId: 'conv-style-en',
        requestId: 'r-style-en',
        metadata: { slackUserId: 'U1', conversationId: 'conv-style-en' },
      },
      {
        toolRegistry: registry,
        decisionNow: FIXED_NOW,
        generate: async () => {
          turn += 1;
          if (turn === 1) return { text: '', model: 'm' };
          return { text: englishReply, model: 'm' };
        },
      }
    );

    const text = normalizeSlackMrkdwn(result.text);
    expect(text).toMatch(/You logged/i);
    expect(text).not.toMatch(/เมื่อวาน|ชั่วโมง|ลูกค้า/);
    assertPresentationStyle(text);
    assertGroundedInTool(text, july18);
  });

  it('empty day — no bullets, no integration error language', async () => {
    const empty: DailyTimesheet = {
      date: '2026-07-18',
      entries: [],
      totalHours: 0,
      expectedHours: 8,
      remainingHours: 8,
      submitted: false,
    };
    const deps = makeDeps(empty);
    const registry = createToolRegistry();
    registry.register(createGetTimesheetTool(deps));

    let turn = 0;
    const result = await runConversationForTest(
      {
        userMessage: 'เมื่อวานฉันทำอะไร',
        conversationId: 'conv-style-empty',
        requestId: 'r-style-empty',
        metadata: { slackUserId: 'U1', conversationId: 'conv-style-empty' },
      },
      {
        toolRegistry: registry,
        decisionNow: FIXED_NOW,
        generate: async () => {
          turn += 1;
          if (turn === 1) return { text: '', model: 'm' };
          return { text: 'เมื่อวานคุณยังไม่ได้ลงเวลาครับ', model: 'm' };
        },
      }
    );

    expect(result.text).toBe('เมื่อวานคุณยังไม่ได้ลงเวลาครับ');
    expect(result.text).not.toContain('•');
    expect(result.text).not.toMatch(/เชื่อมต่อ|integration|ไม่สามารถอ่าน/i);
    expect(result.text).not.toMatch(/เวลาที่คาดหวัง/);
  });

  it('expected hours omitted for plain “what did I do”; allowed when asked', async () => {
    expect(AI_TIMESHEET_SYSTEM_PROMPT).toMatch(
      /expectedHours \/ remainingHours \/ submitted only when/
    );
    const plain = normalizeSlackMrkdwn(
      'เมื่อวานคุณลงเวลาไว้ทั้งหมด *10 ชั่วโมง* ครับ\n\n• *Hertz* — Commerce Suite: Development 5 ชั่วโมง'
    );
    assertPresentationStyle(plain);

    const completionAsk =
      'เมื่อวานคุณลงเวลาไว้ *10 ชั่วโมง* จากที่คาดหวัง 8 ชั่วโมง ครบแล้วครับ (คงเหลือ 0)';
    expect(completionAsk).toMatch(/คาดหวัง|8/);
  });

  it('range summary stays concise', async () => {
    const deps = makeDeps();
    const registry = createToolRegistry();
    registry.register(createGetTimesheetRangeTool(deps));

    let turn = 0;
    const result = await runConversationForTest(
      {
        userMessage: 'สรุปสัปดาห์นี้',
        conversationId: 'conv-style-week',
        requestId: 'r-style-week',
        metadata: { slackUserId: 'U1', conversationId: 'conv-style-week' },
      },
      {
        toolRegistry: registry,
        decisionNow: FIXED_NOW,
        generate: async () => {
          turn += 1;
          if (turn === 1) return { text: '', model: 'm' };
          return {
            text: 'สัปดาห์นี้คุณลงเวลาไว้รวม *10 ชั่วโมง* ครับ',
            model: 'm',
          };
        },
      }
    );

    const text = normalizeSlackMrkdwn(result.text);
    expect(text).toContain('10 ชั่วโมง');
    expect(text).not.toContain('**');
    expect(text).not.toContain('|');
    expect(text).not.toContain('get_timesheet_range');
  });
});

describe('Task mapping (not Role)', () => {
  it('maps Sheets Task ID / Task to taskId / taskName', () => {
    const row: TimeLogRow = {
      'Time Log ID': 'tl1',
      Date: '2026-07-18',
      'Staff ID': 'S0005',
      'Staff First Name': 'A',
      'Staff Last Name': 'B',
      'Staff Position': 'Dev',
      'Project ID': '73',
      'Project Client': 'Hertz',
      'Project Name': 'Commerce Suite',
      'Project Code': 'HERTZ-PLATFORM-2026-01',
      'Task ID': '3',
      Task: 'Development',
      Hours: 5,
    };
    const entry = mapTimeLogRowToEntry(row);
    expect(entry.taskId).toBe('3');
    expect(entry.taskName).toBe('Development');
    expect(entry.roleId).toBe('3');
    expect(entry.roleName).toBe('Development');
  });
});

describe('Slack delivery normalizes Markdown from conversation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('chat.postMessage receives Slack bold, not **', async () => {
    const postMessage = vi.fn(async () => ({ ok: true, ts: '1.0' }));
    const client = {
      chat: { postMessage },
    } as unknown as SlackPostMessageClient;

    await sendMessage('C1', '**รวมเวลา:** 10 ชั่วโมง', { client });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: '*รวมเวลา:* 10 ชั่วโมง' })
    );
  });
});

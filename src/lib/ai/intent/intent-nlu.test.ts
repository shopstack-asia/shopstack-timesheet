import { describe, expect, it, vi } from 'vitest';
import {
  decideWithIntentExtraction,
  enforceStructuredIntent,
  parseStructuredIntent,
  createInMemoryIntentDraftStore,
  looksLikeBusinessTimesheetText,
  isAiIntentExtractionEnabled,
  type ExtractIntentFn,
  type StructuredIntent,
} from '@/lib/ai/intent';
import { runConversation, enforceRequiredBusinessTool } from '@/lib/ai/conversation';
import { decideBusinessTool } from '@/lib/ai/decision-engine';
import { createDefaultToolRegistry } from '@/lib/tools';
import type { Project, Task } from '@/types';

const FIXED_NOW = new Date('2026-07-18T17:00:00.000Z'); // Bangkok 2026-07-19

const RMS_PROJECT: Project = {
  ProjectID: 'P-RMS',
  ProjectName: 'Retail Management',
  ProjectCode: 'RMS',
  ProjectClient: 'Client',
};

const PM_TASK: Task = {
  TaskID: 'T-PM',
  Task: 'Project Management',
};

const CREATE_NL_EXAMPLES = [
  'ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM',
  'วันนี้ลง RMS 3 ชั่วโมง งาน PM',
  'ช่วยบันทึกเวลา RMS ให้หน่อย 3 ชม วันนี้ทำ PM',
  'วันนี้ทำโปรเจกต์ RMS ไปสามชั่วโมง เป็น Project Management',
  'log 3 hrs today for RMS, PM task',
  'Add three hours to RMS today under project management',
  'ลงเวลาวันนี RMS 3 ชม PM',
  'ลงเวลา RMS วันนี้ 3 ชม. เป็นพีเอ็ม',
];

function createIntent(partial: Partial<StructuredIntent>): StructuredIntent {
  return {
    domain: 'timesheet',
    intent: 'create_timesheet_entry',
    confidence: 'high',
    dateExpression: 'วันนี้',
    projectHint: 'RMS',
    taskHint: 'PM',
    hours: 3,
    missingFields: [],
    ambiguities: [],
    ...partial,
  };
}

/** Test double: maps natural language fixtures to structured intents (not production). */
const fixtureExtractor: ExtractIntentFn = async ({ userMessage, draftSummary }) => {
  const t = userMessage.trim();

  if (/^(ยืนยัน|confirm)$/i.test(t)) {
    return createIntent({
      intent: 'confirm_timesheet_change',
      dateExpression: null,
      projectHint: null,
      taskHint: null,
      hours: null,
    });
  }
  if (/^(ยกเลิก|cancel)$/i.test(t)) {
    return createIntent({
      intent: 'cancel_timesheet_change',
      dateExpression: null,
      projectHint: null,
      taskHint: null,
      hours: null,
    });
  }

  if (draftSummary && /^(PM|พีเอ็ม|Development|3|วันนี้)$/i.test(t)) {
    const draft = JSON.parse(draftSummary) as {
      intent: string;
      missingFields: string[];
    };
    if (draft.missingFields.includes('task') || t === 'PM' || t === 'พีเอ็ม') {
      return createIntent({
        intent: 'create_timesheet_entry',
        taskHint: t === 'พีเอ็ม' ? 'PM' : t,
        hours: null,
        projectHint: null,
        dateExpression: null,
        refersToPrevious: true,
      });
    }
    if (draft.missingFields.includes('hours') && t === '3') {
      return createIntent({
        hours: 3,
        taskHint: null,
        projectHint: null,
        dateExpression: null,
        refersToPrevious: true,
      });
    }
    if (draft.missingFields.includes('date') && t === 'วันนี้') {
      return createIntent({
        dateExpression: 'วันนี้',
        taskHint: null,
        projectHint: null,
        hours: null,
        refersToPrevious: true,
      });
    }
  }

  if (
    CREATE_NL_EXAMPLES.some((e) => e === t) ||
    /ลงเวลา.*RMS|RMS.*PM|log 3 hrs|three hours.*RMS/i.test(t)
  ) {
    const taskHint = /Project Management/i.test(t)
      ? 'Project Management'
      : 'PM';
    return createIntent({ taskHint, hours: 3 });
  }

  if (t === 'ลงเวลา RMS วันนี้') {
    return createIntent({
      hours: null,
      taskHint: null,
      missingFields: ['task', 'hours'],
    });
  }
  if (t === 'ลงเวลา 3 ชั่วโมง') {
    return createIntent({
      dateExpression: null,
      projectHint: null,
      taskHint: null,
      hours: 3,
      missingFields: ['date', 'project', 'task'],
    });
  }
  if (t === 'แก้เวลา RMS') {
    return createIntent({
      intent: 'update_timesheet_entry',
      dateExpression: null,
      projectHint: 'RMS',
      taskHint: null,
      hours: null,
      missingFields: ['date', 'hours'],
    });
  }
  if (/what projects|โปรเจกต์ของฉัน|work context/i.test(t)) {
    return createIntent({
      domain: 'work_context',
      intent: 'get_work_context',
      dateExpression: null,
      projectHint: null,
      taskHint: null,
      hours: null,
    });
  }
  if (/timesheet today|วันนี้ฉันทำอะไร/i.test(t)) {
    return createIntent({
      intent: 'get_timesheet_day',
      dateExpression: 'วันนี้',
      projectHint: null,
      taskHint: null,
      hours: null,
    });
  }
  if (/this week|สัปดาห์นี้/i.test(t) && /timesheet|สรุป/i.test(t)) {
    return createIntent({
      intent: 'get_timesheet_range',
      dateExpression: 'สัปดาห์นี้',
      startDateExpression: 'สัปดาห์นี้',
      projectHint: null,
      taskHint: null,
      hours: null,
    });
  }
  if (/hello|สวัสดี|ขอบคุณ/i.test(t)) {
    return createIntent({
      domain: 'general',
      intent: 'general_conversation',
      dateExpression: null,
      projectHint: null,
      taskHint: null,
      hours: null,
    });
  }
  if (/submit.*week|ส่ง timesheet/i.test(t)) {
    return createIntent({
      intent: 'submit_timesheet',
      dateExpression: null,
      projectHint: null,
      taskHint: null,
      hours: null,
    });
  }

  return createIntent({
    intent: 'unknown',
    domain: 'unknown',
    dateExpression: null,
    projectHint: null,
    taskHint: null,
    hours: null,
  });
};

const resolveProjectFn = async (input: {
  projectId?: string;
  projectName?: string;
}) => {
  const hint = (input.projectName || input.projectId || '').toLowerCase();
  if (hint === 'rms' || hint === 'p-rms') {
    return { status: 'resolved' as const, value: RMS_PROJECT };
  }
  if (hint === 'ambiguous') {
    return {
      status: 'ambiguous' as const,
      candidates: [
        RMS_PROJECT,
        { ...RMS_PROJECT, ProjectID: 'P2', ProjectCode: 'RMS2' },
      ],
    };
  }
  if (hint === 'unknown') return { status: 'not_found' as const };
  return { status: 'not_found' as const };
};

const resolveTaskFn = async (input: {
  taskId?: string;
  taskName?: string;
}) => {
  const hint = (input.taskName || input.taskId || '').toLowerCase();
  if (
    hint === 'pm' ||
    hint === 'project management' ||
    hint === 't-pm' ||
    hint === 'พีเอ็ม'
  ) {
    return { status: 'resolved' as const, value: PM_TASK };
  }
  if (hint === 'ambiguous') {
    return {
      status: 'ambiguous' as const,
      candidates: [PM_TASK, { TaskID: 'T2', Task: 'Product Management' }],
    };
  }
  if (hint === 'unknown') return { status: 'not_found' as const };
  return { status: 'not_found' as const };
};

describe('AI intent schema', () => {
  it('parses valid structured intent and rejects identity fields', () => {
    const ok = parseStructuredIntent({
      domain: 'timesheet',
      intent: 'create_timesheet_entry',
      confidence: 'high',
      dateExpression: 'วันนี้',
      projectHint: 'RMS',
      taskHint: 'PM',
      hours: 3,
      missingFields: [],
      ambiguities: [],
    });
    expect(ok.intent).toBe('create_timesheet_entry');
    expect(() =>
      parseStructuredIntent({
        domain: 'timesheet',
        intent: 'create_timesheet_entry',
        confidence: 'high',
        employeeId: 'S1',
        missingFields: [],
        ambiguities: [],
      })
    ).toThrow(/forbidden identity/);
  });

  it('rejects malformed output', () => {
    expect(() => parseStructuredIntent('not-json-object')).toThrow();
    expect(() =>
      parseStructuredIntent({ domain: 'timesheet', intent: 'nope' })
    ).toThrow();
  });
});

describe('feature flag', () => {
  it('is disabled unless explicitly enabled', () => {
    expect(isAiIntentExtractionEnabled({})).toBe(false);
    expect(
      isAiIntentExtractionEnabled({ AI_INTENT_EXTRACTION_ENABLED: 'true' })
    ).toBe(true);
    expect(
      isAiIntentExtractionEnabled({ AI_INTENT_EXTRACTION_ENABLED: 'false' })
    ).toBe(false);
  });
});

describe('natural language → prepare_create_timesheet_entry', () => {
  for (const msg of CREATE_NL_EXAMPLES) {
    it(`routes: ${msg}`, async () => {
      const extracted = await fixtureExtractor({ userMessage: msg });
      const decision = await enforceStructuredIntent(extracted, {
        now: FIXED_NOW,
        userMessage: msg,
        resolveProjectFn,
        resolveTaskFn,
        draftStore: createInMemoryIntentDraftStore(),
        conversationId: 'C1',
        slackUserId: 'U1',
      });
      expect(decision.action).toBe('call_tool');
      if (decision.action !== 'call_tool') return;
      expect(decision.toolName).toBe('prepare_create_timesheet_entry');
      expect(decision.arguments.date).toBe('2026-07-19');
      expect(decision.arguments.hours).toBe(3);
      expect(decision.arguments.projectId).toBe('P-RMS');
      expect(decision.arguments.taskId).toBe('T-PM');
    });
  }
});

describe('clarifications', () => {
  it('asks for task and hours when missing', async () => {
    const d = await enforceStructuredIntent(
      createIntent({
        hours: null,
        taskHint: null,
        missingFields: ['task', 'hours'],
      }),
      {
        now: FIXED_NOW,
        userMessage: 'ลงเวลา RMS วันนี้',
        resolveProjectFn,
        resolveTaskFn,
        draftStore: createInMemoryIntentDraftStore(),
        conversationId: 'C1',
        slackUserId: 'U1',
      }
    );
    expect(d.action).toBe('clarify');
    if (d.action !== 'clarify') return;
    expect(d.message).toMatch(/งาน|ชั่วโมง/);
    expect(d.reason).not.toMatch(/identity/);
  });

  it('asks for date and project when only hours given', async () => {
    const d = await enforceStructuredIntent(
      createIntent({
        dateExpression: null,
        projectHint: null,
        taskHint: null,
        hours: 3,
        missingFields: ['date', 'project', 'task'],
      }),
      { now: FIXED_NOW, userMessage: 'ลงเวลา 3 ชั่วโมง' }
    );
    expect(d.action).toBe('clarify');
    if (d.action !== 'clarify') return;
    expect(d.message).toMatch(/วันที่|Project/);
  });

  it('asks for update details', async () => {
    const d = await enforceStructuredIntent(
      createIntent({
        intent: 'update_timesheet_entry',
        dateExpression: null,
        projectHint: 'RMS',
        hours: null,
        taskHint: null,
      }),
      { now: FIXED_NOW, userMessage: 'แก้เวลา RMS' }
    );
    expect(d.action).toBe('clarify');
  });

  it('clarifies ambiguous project/task without inventing IDs', async () => {
    const proj = await enforceStructuredIntent(
      createIntent({ projectHint: 'ambiguous', taskHint: 'PM' }),
      {
        now: FIXED_NOW,
        resolveProjectFn,
        resolveTaskFn,
        userMessage: 'x',
      }
    );
    expect(proj.action).toBe('clarify');
    if (proj.action === 'clarify') {
      expect(proj.reason).toBe('ambiguous_project');
      expect(proj.message).not.toMatch(/identity|access/i);
    }

    const task = await enforceStructuredIntent(
      createIntent({ projectHint: 'RMS', taskHint: 'ambiguous' }),
      {
        now: FIXED_NOW,
        resolveProjectFn,
        resolveTaskFn,
        userMessage: 'x',
      }
    );
    expect(task.action).toBe('clarify');
    if (task.action === 'clarify') {
      expect(task.reason).toBe('ambiguous_task');
    }
  });

  it('returns controlled not_found for project/task', async () => {
    const d = await enforceStructuredIntent(
      createIntent({ projectHint: 'unknown', taskHint: 'PM' }),
      { now: FIXED_NOW, resolveProjectFn, resolveTaskFn, userMessage: 'x' }
    );
    expect(d.action).toBe('clarify');
    if (d.action === 'clarify') {
      expect(d.reason).toBe('project_not_found');
      expect(d.message).not.toMatch(/identity|verify|access/i);
    }
  });
});

describe('follow-up drafts', () => {
  it('completes task from second message', async () => {
    const store = createInMemoryIntentDraftStore();
    const first = await enforceStructuredIntent(
      createIntent({
        taskHint: null,
        hours: 3,
        missingFields: ['task'],
      }),
      {
        now: FIXED_NOW,
        draftStore: store,
        conversationId: 'C-draft',
        slackUserId: 'U1',
        resolveProjectFn,
        resolveTaskFn,
        userMessage: 'ลงเวลา RMS วันนี้ 3 ชั่วโมง',
      }
    );
    expect(first.action).toBe('clarify');

    const second = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      intentExtractionEnabled: true,
      extractIntent: fixtureExtractor,
      draftStore: store,
      conversationId: 'C-draft',
      slackUserId: 'U1',
      resolveProjectFn,
      resolveTaskFn,
    });
    expect(second.decision.action).toBe('call_tool');
    if (second.decision.action === 'call_tool') {
      expect(second.decision.toolName).toBe('prepare_create_timesheet_entry');
      expect(second.decision.arguments.taskId).toBe('T-PM');
    }
  });

  it('isolates draft ownership by slack user', async () => {
    const store = createInMemoryIntentDraftStore();
    await enforceStructuredIntent(
      createIntent({ taskHint: null, missingFields: ['task'] }),
      {
        now: FIXED_NOW,
        draftStore: store,
        conversationId: 'C-own',
        slackUserId: 'U1',
        resolveProjectFn,
        resolveTaskFn,
        userMessage: 'ลงเวลา RMS วันนี้ 3 ชั่วโมง',
      }
    );
    expect(await store.get('C-own', 'U2')).toBeUndefined();
    expect(await store.get('C-own', 'U1')).toBeDefined();
  });

  it('expires drafts', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-exp',
      slackUserId: 'U1',
      missingFields: ['task'],
      createdAt: new Date(0).toISOString(),
      expiresAt: new Date(0).toISOString(),
    });
    expect(await store.get('C-exp', 'U1')).toBeUndefined();
  });

  it('draft never carries identity fields', async () => {
    const store = createInMemoryIntentDraftStore();
    await enforceStructuredIntent(
      createIntent({ taskHint: null, missingFields: ['task'] }),
      {
        now: FIXED_NOW,
        draftStore: store,
        conversationId: 'C-id',
        slackUserId: 'U1',
        resolveProjectFn,
        resolveTaskFn,
        userMessage: 'x',
      }
    );
    const draft = await store.get('C-id', 'U1');
    expect(draft).toBeDefined();
    expect(JSON.stringify(draft)).not.toMatch(/employeeId|email|staffId/);
  });
});

describe('safety and enforcement', () => {
  it('overwrites wrong model tool selection', () => {
    const decision = {
      action: 'call_tool' as const,
      toolName: 'prepare_create_timesheet_entry' as const,
      arguments: {
        date: '2026-07-19',
        hours: 3,
        projectId: 'P-RMS',
        taskId: 'T-PM',
      },
      reason: 'test',
    };
    const enforced = enforceRequiredBusinessTool(
      [
        {
          id: '1',
          type: 'function',
          function: { name: 'get_my_profile', arguments: '{}' },
        },
      ],
      decision
    );
    expect(enforced.enforced).toBe(true);
    expect(enforced.toolCalls[0]!.function.name).toBe(
      'prepare_create_timesheet_entry'
    );
  });

  it('registry has no direct-write tools', () => {
    const names = createDefaultToolRegistry()
      .list()
      .map((t) => t.name);
    expect(names).not.toContain('submit_day_timesheet');
    expect(names).not.toContain('clear_day_timesheet');
    expect(names).toContain('prepare_create_timesheet_entry');
    expect(names).toContain('confirm_timesheet_change');
  });

  it('submit routes to prepare_submit_timesheet', async () => {
    const d = await enforceStructuredIntent(
      createIntent({
        intent: 'submit_timesheet',
        dateExpression: null,
        projectHint: null,
        taskHint: null,
        hours: null,
      }),
      { now: FIXED_NOW }
    );
    expect(d.action).toBe('call_tool');
    if (d.action === 'call_tool') {
      expect(d.toolName).toBe('prepare_submit_timesheet');
    }
  });
});

describe('error integrity', () => {
  it('project/task failures never mention identity', async () => {
    const d = await enforceStructuredIntent(
      createIntent({ projectHint: 'unknown', taskHint: 'PM' }),
      { now: FIXED_NOW, resolveProjectFn, resolveTaskFn, userMessage: 'x' }
    );
    if (d.action === 'clarify') {
      expect(d.message).not.toMatch(
        /identity|cannot access|verify identity|ไม่สามารถเข้าถึง/i
      );
    }
  });

  it('fallback for business text does not invent identity error', async () => {
    const result = await decideWithIntentExtraction(
      'ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM',
      {
        now: FIXED_NOW,
        intentExtractionEnabled: true,
        extractIntent: async () => {
          throw new Error('extraction_failed: boom');
        },
      }
    );
    expect(result.fallbackUsed).toBe(true);
    if (result.decision.action === 'clarify') {
      expect(result.decision.message).not.toMatch(/identity|access/i);
    }
  });

  it('malformed intent does not become identity error', async () => {
    const result = await decideWithIntentExtraction('ลงเวลา RMS', {
      now: FIXED_NOW,
      intentExtractionEnabled: true,
      extractIntent: async () => {
        throw new Error('malformed_intent: bad');
      },
    });
    expect(result.typedErrorCode).toBe('malformed_intent');
    expect(result.fallbackUsed).toBe(true);
  });
});

describe('regression: regex Decision Engine still works when flag off', () => {
  it('preserves bare confirm and general none', () => {
    expect(
      decideBusinessTool('ยืนยัน', {
        pendingChanges: [{ confirmationId: 'c1', summary: 's' }],
      })
    ).toMatchObject({
      action: 'call_tool',
      toolName: 'confirm_timesheet_change',
    });
    expect(decideBusinessTool('ขอบคุณ').action).toBe('none');
  });

  it('runConversation with flag off uses decideTool path', async () => {
    const decideTool = vi.fn(() => ({
      action: 'none' as const,
      reason: 'general_conversation',
    }));
    const generate = vi.fn(async () => ({
      text: 'hello',
      model: 'test',
    }));
    const result = await runConversation(
      {
        userMessage: 'hi',
        conversationId: 'c',
        metadata: { slackUserId: 'U1' },
      },
      {
        decideTool,
        generate,
        intentExtractionEnabled: false,
        enableTools: false,
      }
    );
    expect(decideTool).toHaveBeenCalled();
    expect(result.text).toBe('hello');
  });
});

describe('looksLikeBusinessTimesheetText', () => {
  it('detects the failing production sentence', () => {
    expect(
      looksLikeBusinessTimesheetText('ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM')
    ).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideWithIntentExtraction,
  enforceStructuredIntent,
  parseStructuredIntent,
  createInMemoryIntentDraftStore,
  looksLikeBusinessTimesheetText,
  EXTRACTION_FAILED_MESSAGE_TH,
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

/** Fixture extractor for deterministic enforcement unit coverage only.
 * Production extraction boundary tests live in intent-draft-safety.test.ts (mocked OpenAI).
 * Live model quality is verified in production Slack after deploy (no staging).
 */
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

describe('AI-first is unconditional', () => {
  const removedFlagName = ['AI', 'INTENT', 'EXTRACTION', 'ENABLED'].join('_');

  it('removed intent flag name is absent from production source', () => {
    const srcRoot = join(process.cwd(), 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (
          /\.(ts|tsx|js|mjs)$/.test(entry.name) &&
          !entry.name.includes('.test.')
        ) {
          files.push(p);
        }
      }
    };
    walk(srcRoot);
    for (const file of files) {
      const body = readFileSync(file, 'utf8');
      expect(body).not.toContain(removedFlagName);
      expect(body).not.toMatch(/forceRegexFallback/);
      expect(body).not.toMatch(/isAiIntentExtractionEnabled/);
    }
  });

  it('runs structured extraction with no env flag set', async () => {
    delete process.env[removedFlagName];
    const extractIntent = vi.fn(async () =>
      createIntent({ intent: 'general_conversation', domain: 'general' })
    );
    const result = await decideWithIntentExtraction('ขอบคุณ', {
      now: FIXED_NOW,
      extractIntent,
      conversationId: 'C-flag',
      slackUserId: 'U1',
    });
    expect(extractIntent).toHaveBeenCalled();
    expect(result.extractionOutcome).toBe('general_conversation');
    expect(result.decision.action).toBe('none');
  });

  it('legacy false env value has no effect because the flag is unread', async () => {
    process.env[removedFlagName] = 'false';
    const extractIntent = vi.fn(async () =>
      createIntent({ intent: 'general_conversation', domain: 'general' })
    );
    await decideWithIntentExtraction('สวัสดี', {
      now: FIXED_NOW,
      extractIntent,
    });
    expect(extractIntent).toHaveBeenCalled();
    delete process.env[removedFlagName];
  });

  it('runConversation always calls extractor for non-bare messages', async () => {
    const extractIntent = vi.fn(async () =>
      createIntent({ intent: 'general_conversation', domain: 'general' })
    );
    const generate = vi.fn(async () => ({ text: 'ok', model: 'm' }));
    await runConversation(
      {
        userMessage: 'สวัสดี',
        conversationId: 'c',
        metadata: { slackUserId: 'U1' },
      },
      { extractIntent, generate, enableTools: false }
    );
    expect(extractIntent).toHaveBeenCalled();
  });

  it('natural Timesheet language never calls decideBusinessTool', async () => {
    const spy = vi.spyOn(
      await import('@/lib/ai/decision-engine'),
      'decideBusinessTool'
    );
    const extractIntent = vi.fn(async () =>
      createIntent({
        hours: null,
        taskHint: null,
        missingFields: ['task', 'hours'],
      })
    );
    await decideWithIntentExtraction('ลงเวลา RMS วันนี้', {
      now: FIXED_NOW,
      extractIntent,
      resolveProjectFn,
      resolveTaskFn,
      draftStore: createInMemoryIntentDraftStore(),
      conversationId: 'C-nl',
      slackUserId: 'U1',
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
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
    expect((await store.get('C-own', 'U2')).outcome).toBe('draft_not_found');
    expect((await store.get('C-own', 'U1')).outcome).toBe('draft_found');
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
    expect((await store.get('C-exp', 'U1')).outcome).toBe('draft_expired');
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
    expect(draft.outcome).toBe('draft_found');
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

describe('extraction failure (fail-closed)', () => {
  const failureCases = [
    ['timeout', 'extraction_failed: timeout'],
    ['network', 'extraction_failed: network'],
    ['rate limit', 'extraction_failed: rate_limited'],
    ['invalid JSON', 'extraction_failed: invalid_json'],
    ['empty response', 'extraction_failed: empty_response'],
    ['malformed intent', 'malformed_intent: bad'],
    ['forbidden identity field', 'malformed_intent: forbidden identity'],
  ] as const;

  for (const [label, errMsg] of failureCases) {
    it(`${label} returns controlled clarification and zero tools`, async () => {
      const decideSpy = vi.spyOn(
        await import('@/lib/ai/decision-engine'),
        'decideBusinessTool'
      );
      const result = await decideWithIntentExtraction(
        'ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM',
        {
          now: FIXED_NOW,
          extractIntent: async () => {
            throw new Error(errMsg);
          },
        }
      );
      expect(result.extractionOutcome).toBe('extraction_failed');
      expect(result.decision.action).toBe('clarify');
      if (result.decision.action === 'clarify') {
        expect(result.decision.message).toBe(EXTRACTION_FAILED_MESSAGE_TH);
        expect(result.decision.message).not.toMatch(
          /identity|employee|access|Redis|OpenAI|Project not found/i
        );
      }
      expect(decideSpy).not.toHaveBeenCalled();
      decideSpy.mockRestore();
    });
  }

  it('runConversation on extraction failure never invents identity wording', async () => {
    const generate = vi.fn(async () => ({
      text: 'You are employee S1',
      model: 'm',
    }));
    const result = await runConversation(
      {
        userMessage: 'ลงเวลา RMS วันนี้',
        conversationId: 'c-fail',
        metadata: { slackUserId: 'U1' },
      },
      {
        extractIntent: async () => {
          throw new Error('extraction_failed: boom');
        },
        generate,
        enableTools: true,
        toolRegistry: createDefaultToolRegistry(),
      }
    );
    expect(generate).not.toHaveBeenCalled();
    expect(result.text).toBe(EXTRACTION_FAILED_MESSAGE_TH);
    expect(result.toolRounds).toBe(0);
    expect(result.text).not.toMatch(/identity|employee|access/i);
  });

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
});

describe('deterministic helpers remain for bare confirm/cancel (isolated)', () => {
  it('preserves bare confirm via write-decision path through decideBusinessTool helper', () => {
    expect(
      decideBusinessTool('ยืนยัน', {
        pendingChanges: [{ confirmationId: 'c1', summary: 's' }],
      })
    ).toMatchObject({
      action: 'call_tool',
      toolName: 'confirm_timesheet_change',
    });
  });

  it('bare confirm skips extractor in production orchestrator', async () => {
    const extractIntent = vi.fn(async () => createIntent({}));
    const result = await decideWithIntentExtraction('ยืนยัน', {
      now: FIXED_NOW,
      extractIntent,
      pendingChanges: [{ confirmationId: 'c1', summary: 'create RMS' }],
    });
    expect(extractIntent).not.toHaveBeenCalled();
    expect(result.extractionOutcome).toBe('skipped_deterministic');
    expect(result.decision).toMatchObject({
      action: 'call_tool',
      toolName: 'confirm_timesheet_change',
    });
  });

  it('bare cancel skips extractor when pending exists', async () => {
    const extractIntent = vi.fn(async () => createIntent({}));
    const result = await decideWithIntentExtraction('ยกเลิก', {
      now: FIXED_NOW,
      extractIntent,
      pendingChanges: [{ confirmationId: 'c1', summary: 'create RMS' }],
    });
    expect(extractIntent).not.toHaveBeenCalled();
    expect(result.extractionOutcome).toBe('skipped_deterministic');
  });
});

describe('looksLikeBusinessTimesheetText', () => {
  it('detects the failing production sentence', () => {
    expect(
      looksLikeBusinessTimesheetText('ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM')
    ).toBe(true);
  });
});

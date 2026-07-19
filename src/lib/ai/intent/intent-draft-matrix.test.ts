/**
 * Complete Draft follow-up state-machine matrix (PR #16).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  decideWithIntentExtraction,
  decideDraftMerge,
  createInMemoryIntentDraftStore,
  type StructuredIntent,
  type IntentDraft,
} from '@/lib/ai/intent';
import type { Project, Task } from '@/types';

const FIXED_NOW = new Date('2026-07-18T17:00:00.000Z'); // Bangkok 2026-07-19

const RMS: Project = {
  ProjectID: 'P-RMS',
  ProjectName: 'Raw Material Supply Management System',
  ProjectCode: 'RMS',
  ProjectClient: 'Mitrphol',
};

const HERTZ: Project = {
  ProjectID: 'P-HERTZ',
  ProjectName: 'Hertz Commerce',
  ProjectCode: 'HERTZ',
  ProjectClient: 'Hertz',
};

const PM_TASK: Task = { TaskID: 'T-PM', Task: 'Project Management' };
const DEV_TASK: Task = { TaskID: 'T-DEV', Task: 'Development' };
const PM_ALT: Task = { TaskID: 'T-PM2', Task: 'Product Management' };

vi.mock('@/lib/google-sheets', () => ({
  getCachedProjects: async () => [RMS, HERTZ],
  getCachedTasks: async () => [PM_TASK, DEV_TASK],
}));

function baseDraft(
  missing: IntentDraft['missingFields'],
  extra: Partial<IntentDraft> = {}
): IntentDraft {
  const now = new Date().toISOString();
  return {
    intent: 'create_timesheet_entry',
    conversationId: 'C-matrix',
    slackUserId: 'U1',
    resolvedDate: '2026-07-19',
    projectHint: 'RMS',
    resolvedProjectId: 'P-RMS',
    taskHint: 'Project Management',
    resolvedTaskId: 'T-PM',
    hours: 3,
    missingFields: missing,
    lastClarificationField: missing[0],
    clarificationCount: 1,
    createdAt: now,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    ...extra,
  };
}

function intent(partial: Partial<StructuredIntent>): StructuredIntent {
  return {
    domain: 'timesheet',
    intent: 'create_timesheet_entry',
    confidence: 'high',
    dateExpression: null,
    projectHint: null,
    taskHint: null,
    hours: null,
    missingFields: [],
    ambiguities: [],
    refersToPrevious: false,
    ...partial,
  };
}

describe('decideDraftMerge state-machine matrix', () => {
  const cases: Array<{
    name: string;
    draft: IntentDraft;
    message: string;
    model: Partial<StructuredIntent>;
    resolveTaskFn?: typeof import('@/lib/timesheet/write/master-resolve').resolveTask;
    resolveProjectFn?: typeof import('@/lib/timesheet/write/master-resolve').resolveProject;
    expectKind: string;
    expectReason: string;
    expectMerge: boolean;
  }> = [
    {
      name: 'B/task/resolved/general → override merge',
      draft: baseDraft(['task'], {
        taskHint: undefined,
        resolvedTaskId: undefined,
      }),
      message: 'PM',
      model: { intent: 'general_conversation', domain: 'general' },
      expectKind: 'merge_resolved',
      expectReason: 'structural_follow_up_overrode_general',
      expectMerge: true,
    },
    {
      name: 'B/task/not_found/general → unmatched general',
      draft: baseDraft(['task'], {
        taskHint: undefined,
        resolvedTaskId: undefined,
      }),
      message: 'อธิบาย microservice',
      model: { intent: 'general_conversation', domain: 'general' },
      expectKind: 'general',
      expectReason: 'general_conversation_unmatched',
      expectMerge: false,
    },
    {
      name: 'C/task/resolved/unknown → override merge',
      draft: baseDraft(['task'], {
        taskHint: undefined,
        resolvedTaskId: undefined,
      }),
      message: 'PM',
      model: { intent: 'unknown', domain: 'unknown' },
      expectKind: 'merge_resolved',
      expectReason: 'structural_follow_up_overrode_unknown',
      expectMerge: true,
    },
    {
      name: 'C/task/not_found/unknown → re-clarify target',
      draft: baseDraft(['task'], {
        taskHint: undefined,
        resolvedTaskId: undefined,
      }),
      message: 'ZZZ',
      model: { intent: 'unknown', domain: 'unknown' },
      expectKind: 'clarify_target',
      expectReason: 'outstanding_slot_unmatched',
      expectMerge: false,
    },
    {
      name: 'A/task/not_found/continue → clarify with candidates',
      draft: baseDraft(['task'], {
        taskHint: undefined,
        resolvedTaskId: undefined,
      }),
      message: 'ต่อจากเมื่อกี้ ใช้ ZZZ',
      model: { intent: 'general_conversation', domain: 'general' },
      expectKind: 'clarify_with_hint',
      expectReason: 'candidate_not_found',
      expectMerge: false,
    },
    {
      name: 'B/hours/resolved/general → merge',
      draft: baseDraft(['hours'], { hours: undefined }),
      message: '3',
      model: { intent: 'general_conversation', domain: 'general' },
      expectKind: 'merge_resolved',
      expectReason: 'structural_follow_up_overrode_general',
      expectMerge: true,
    },
    {
      name: 'B/hours/invalid/general → unmatched general',
      draft: baseDraft(['hours'], { hours: undefined }),
      message: 'PM',
      model: { intent: 'general_conversation', domain: 'general' },
      expectKind: 'general',
      expectReason: 'general_conversation_unmatched',
      expectMerge: false,
    },
    {
      name: 'B/date/resolved/general → merge',
      draft: baseDraft(['date'], {
        resolvedDate: undefined,
        dateExpression: undefined,
      }),
      message: 'พรุ่งนี้',
      model: { intent: 'general_conversation', domain: 'general' },
      expectKind: 'merge_resolved',
      expectReason: 'structural_follow_up_overrode_general',
      expectMerge: true,
    },
    {
      name: 'B/date/invalid/general → unmatched general',
      draft: baseDraft(['date'], {
        resolvedDate: undefined,
        dateExpression: undefined,
      }),
      message: 'PM',
      model: { intent: 'general_conversation', domain: 'general' },
      expectKind: 'general',
      expectReason: 'general_conversation_unmatched',
      expectMerge: false,
    },
    {
      name: 'B/project/resolved/general → merge',
      draft: baseDraft(['project'], {
        projectHint: undefined,
        resolvedProjectId: undefined,
      }),
      message: 'RMS',
      model: { intent: 'general_conversation', domain: 'general' },
      expectKind: 'merge_resolved',
      expectReason: 'structural_follow_up_overrode_general',
      expectMerge: true,
    },
    {
      name: 'E/different write → intent_mismatch',
      draft: baseDraft(['task'], {
        taskHint: undefined,
        resolvedTaskId: undefined,
      }),
      message: 'PM',
      model: { intent: 'update_timesheet_entry', domain: 'timesheet' },
      expectKind: 'intent_mismatch',
      expectReason: 'intent_mismatch',
      expectMerge: false,
    },
    {
      name: 'unrelated phrase → unrelated_general_phrase',
      draft: baseDraft(['task'], {
        taskHint: undefined,
        resolvedTaskId: undefined,
      }),
      message: 'ขอบคุณ',
      model: { intent: 'general_conversation', domain: 'general' },
      expectKind: 'general',
      expectReason: 'unrelated_general_phrase',
      expectMerge: false,
    },
    {
      name: 'unavailable task resolver → dependency',
      draft: baseDraft(['task'], {
        taskHint: undefined,
        resolvedTaskId: undefined,
      }),
      message: 'PM',
      model: { intent: 'general_conversation', domain: 'general' },
      resolveTaskFn: async () => {
        throw new Error('boom');
      },
      expectKind: 'dependency',
      expectReason: 'master_data_unavailable',
      expectMerge: false,
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const decision = await decideDraftMerge({
        intent: intent(c.model),
        draft: c.draft,
        userMessage: c.message,
        now: FIXED_NOW,
        resolveTaskFn: c.resolveTaskFn,
        resolveProjectFn: c.resolveProjectFn,
      });
      expect(decision.merge).toBe(c.expectMerge);
      expect(decision.reason).toBe(c.expectReason);
      expect(decision.outcome.kind).toBe(c.expectKind);
    });
  }

  it('ambiguous task under general overrides and clarifies', async () => {
    const decision = await decideDraftMerge({
      intent: intent({ intent: 'general_conversation', domain: 'general' }),
      draft: baseDraft(['task'], {
        taskHint: undefined,
        resolvedTaskId: undefined,
      }),
      userMessage: 'PM',
      now: FIXED_NOW,
      resolveTaskFn: async () => ({
        status: 'ambiguous' as const,
        candidates: [PM_TASK, PM_ALT],
      }),
    });
    expect(decision.outcome.kind).toBe('clarify_with_hint');
    expect(decision.reason).toBe('structural_follow_up_overrode_general');
    if (decision.outcome.kind === 'clarify_with_hint') {
      expect(decision.outcome.showCandidates).toBe(true);
      expect(decision.outcome.draftMutated).toBe(true);
    }
  });
});

describe('production-path mandatory tests', () => {
  async function seedTask(store: ReturnType<typeof createInMemoryIntentDraftStore>, id: string) {
    await store.set(
      baseDraft(['task'], {
        conversationId: id,
        taskHint: undefined,
        resolvedTaskId: undefined,
      })
    );
  }

  it('Test 1: complete first phrase prepares', async () => {
    const result = await decideWithIntentExtraction(
      'ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM',
      {
        now: FIXED_NOW,
        extractIntent: async () =>
          intent({
            dateExpression: 'วันนี้',
            projectHint: 'RMS',
            taskHint: 'PM',
            hours: 3,
          }),
        draftStore: createInMemoryIntentDraftStore(),
        conversationId: 'C1',
        slackUserId: 'U1',
      }
    );
    expect(result.decision.action).toBe('call_tool');
    if (result.decision.action === 'call_tool') {
      expect(result.decision.toolName).toBe('prepare_create_timesheet_entry');
      expect(result.decision.arguments).toMatchObject({
        date: '2026-07-19',
        projectId: 'P-RMS',
        taskId: 'T-PM',
        hours: 3,
      });
    }
  });

  it('Test 2: PM general → prepare', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTask(store, 'C2');
    const result = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C2',
      slackUserId: 'U1',
    });
    expect(result.decision.action).toBe('call_tool');
    if (result.decision.action === 'call_tool') {
      expect(result.decision.arguments).toMatchObject({
        projectId: 'P-RMS',
        taskId: 'T-PM',
        hours: 3,
        date: '2026-07-19',
      });
    }
  });

  it('Test 3: unrelated general not_found → none, draft unchanged', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTask(store, 'C3');
    const before = await store.get('C3', 'U1');
    const result = await decideWithIntentExtraction('อธิบาย microservice', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C3',
      slackUserId: 'U1',
    });
    expect(result.decision.action).toBe('none');
    const after = await store.get('C3', 'U1');
    expect(after).toEqual(before);
  });

  it('Test 4: explicit continue not_found → candidates', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTask(store, 'C4');
    const result = await decideWithIntentExtraction('ต่อจากเมื่อกี้ ใช้ ZZZ', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C4',
      slackUserId: 'U1',
    });
    expect(result.decision.action).toBe('clarify');
    if (result.decision.action === 'clarify') {
      expect(result.decision.message).toMatch(/ยังไม่พบ Task/);
      expect(result.decision.message).toMatch(/Development|Project Management/);
    }
    const draft = await store.get('C4', 'U1');
    expect(draft.outcome).toBe('draft_found');
    if (draft.outcome === 'draft_found') {
      expect(draft.draft.resolvedProjectId).toBe('P-RMS');
      expect(draft.draft.hours).toBe(3);
    }
  });

  it('Test 12: general-chat matrix preserves Draft', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTask(store, 'C12');
    const messages = [
      'ช่วยแปลประโยคนี้',
      'Who is the CEO?',
      'อธิบาย microservice',
      'วันนี้มีข่าวอะไร',
      'ทำไมท้องฟ้าสีฟ้า',
      'What is an API?',
    ];
    for (const msg of messages) {
      const before = await store.get('C12', 'U1');
      const result = await decideWithIntentExtraction(msg, {
        now: FIXED_NOW,
        extractIntent: async () =>
          intent({ intent: 'general_conversation', domain: 'general' }),
        draftStore: store,
        conversationId: 'C12',
        slackUserId: 'U1',
      });
      expect(result.decision.action).toBe('none');
      const after = await store.get('C12', 'U1');
      expect(after).toEqual(before);
    }
  });

  it('Test 14: resolver unavailable', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTask(store, 'C14');
    const before = await store.get('C14', 'U1');
    const result = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C14',
      slackUserId: 'U1',
      resolveTaskFn: async () => {
        throw new Error('down');
      },
    });
    expect(result.decision.action).toBe('clarify');
    expect(result.decision.reason).toBe('master_data_unavailable');
    expect(result.typedErrorCode).toBe('read_failed');
    const after = await store.get('C14', 'U1');
    expect(after).toEqual(before);
  });

  it('Test 15: explicit cancellation', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTask(store, 'C15');
    const result = await decideWithIntentExtraction('ไม่ลงเวลาแล้ว', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C15',
      slackUserId: 'U1',
    });
    expect(result.decision.reason).toBe('intent_draft_cancelled');
    expect((await store.get('C15', 'U1')).outcome).toBe('draft_not_found');
  });

  it('Test 11: adversarial model fields ignored', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTask(store, 'C11');
    const result = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({
          intent: 'general_conversation',
          domain: 'general',
          projectHint: 'HERTZ',
          taskHint: 'QA',
          dateExpression: 'พรุ่งนี้',
          hours: 8,
        }),
      draftStore: store,
      conversationId: 'C11',
      slackUserId: 'U1',
    });
    expect(result.decision.action).toBe('call_tool');
    if (result.decision.action === 'call_tool') {
      expect(result.decision.arguments).toMatchObject({
        projectId: 'P-RMS',
        taskId: 'T-PM',
        hours: 3,
        date: '2026-07-19',
      });
    }
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  decideWithIntentExtraction,
  enforceStructuredIntent,
  createInMemoryIntentDraftStore,
  enrichWriteIntentSlots,
  applyDraftMerge,
  type StructuredIntent,
} from '@/lib/ai/intent';
import { resolveTask, resolveProject, wordInitials } from '@/lib/timesheet/write/master-resolve';
import type { Project, Task } from '@/types';

const FIXED_NOW = new Date('2026-07-18T17:00:00.000Z'); // Bangkok 2026-07-19

const RMS: Project = {
  ProjectID: 'P-RMS',
  ProjectName: 'Raw Material Supply Management System',
  ProjectCode: 'RMS',
  ProjectClient: 'Mitrphol',
};

const PM_TASK: Task = {
  TaskID: 'T-PM',
  Task: 'Project Management',
};

const DEV_TASK: Task = {
  TaskID: 'T-DEV',
  Task: 'Development',
};

const TEST_TASK: Task = {
  TaskID: 'T-TEST',
  Task: 'Testing',
};

vi.mock('@/lib/google-sheets', () => ({
  getCachedProjects: async () => [RMS],
  getCachedTasks: async () => [PM_TASK, DEV_TASK, TEST_TASK],
}));

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

describe('canonical master resolve', () => {
  it('resolves RMS via project code', async () => {
    const r = await resolveProject({ projectName: 'RMS' });
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') expect(r.value.ProjectID).toBe('P-RMS');
  });

  it('resolves PM via initials to Project Management', async () => {
    expect(wordInitials('Project Management')).toBe('pm');
    const r = await resolveTask({ taskName: 'PM' });
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') expect(r.value.TaskID).toBe('T-PM');
  });

  it('resolves Project Manager to Project Management', async () => {
    const r = await resolveTask({ taskName: 'Project Manager' });
    expect(r.status).toBe('resolved');
    if (r.status === 'resolved') expect(r.value.Task).toBe('Project Management');
  });
});

describe('applyDraftMerge strict target-only slot protection', () => {
  const taskTargetDraft = {
    intent: 'create_timesheet_entry' as const,
    conversationId: 'C1',
    slackUserId: 'U1',
    resolvedDate: '2026-07-19',
    projectHint: 'RMS',
    resolvedProjectId: 'P-RMS',
    hours: 3,
    missingFields: ['task' as const],
    lastClarificationField: 'task',
    clarificationCount: 1,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };

  const projectTargetDraft = {
    intent: 'create_timesheet_entry' as const,
    conversationId: 'C1',
    slackUserId: 'U1',
    resolvedDate: '2026-07-19',
    taskHint: 'Project Management',
    resolvedTaskId: 'T-PM',
    hours: 3,
    missingFields: ['project' as const],
    lastClarificationField: 'project',
    clarificationCount: 1,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };

  const hoursTargetDraft = {
    intent: 'create_timesheet_entry' as const,
    conversationId: 'C1',
    slackUserId: 'U1',
    resolvedDate: '2026-07-19',
    projectHint: 'RMS',
    resolvedProjectId: 'P-RMS',
    taskHint: 'Project Management',
    resolvedTaskId: 'T-PM',
    missingFields: ['hours' as const],
    lastClarificationField: 'hours',
    clarificationCount: 1,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };

  const dateTargetDraft = {
    intent: 'create_timesheet_entry' as const,
    conversationId: 'C1',
    slackUserId: 'U1',
    projectHint: 'RMS',
    resolvedProjectId: 'P-RMS',
    taskHint: 'Project Management',
    resolvedTaskId: 'T-PM',
    hours: 3,
    missingFields: ['date' as const],
    lastClarificationField: 'date',
    clarificationCount: 1,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };

  it('Test A: task target ignores adversarial model project/date/hours', () => {
    const merged = applyDraftMerge(
      createIntent({
        projectHint: 'HERTZ',
        taskHint: 'PM',
        dateExpression: 'พรุ่งนี้',
        hours: 8,
        refersToPrevious: true,
      }),
      taskTargetDraft,
      undefined,
      { userMessage: 'PM', now: FIXED_NOW }
    );
    expect(merged.mergeMode).toBe('targeted_follow_up');
    expect(merged.targetField).toBe('task');
    expect(merged.intent.dateExpression).toBe('2026-07-19');
    expect(merged.intent.projectHint).toBe('RMS');
    expect(merged.intent.taskHint).toBe('PM');
    expect(merged.intent.hours).toBe(3);
    expect(merged.ignoredConflictingFields).toEqual(
      expect.arrayContaining(['project', 'date', 'hours'])
    );
  });

  it('Test B: project target only changes project', () => {
    const merged = applyDraftMerge(
      createIntent({
        projectHint: 'RMS',
        taskHint: 'Development',
        dateExpression: 'พรุ่งนี้',
        hours: 8,
        refersToPrevious: true,
      }),
      projectTargetDraft,
      undefined,
      { userMessage: 'RMS', now: FIXED_NOW }
    );
    expect(merged.intent.projectHint).toBe('RMS');
    expect(merged.intent.taskHint).toBe('Project Management');
    expect(merged.intent.dateExpression).toBe('2026-07-19');
    expect(merged.intent.hours).toBe(3);
  });

  it('Test C: hours target ignores adversarial project', () => {
    const merged = applyDraftMerge(
      createIntent({
        projectHint: 'HERTZ',
        taskHint: 'QA',
        dateExpression: 'พรุ่งนี้',
        hours: 3,
        refersToPrevious: true,
      }),
      hoursTargetDraft,
      undefined,
      { userMessage: '3', now: FIXED_NOW }
    );
    expect(merged.intent.hours).toBe(3);
    expect(merged.intent.projectHint).toBe('RMS');
    expect(merged.intent.taskHint).toBe('Project Management');
    expect(merged.intent.dateExpression).toBe('2026-07-19');
  });

  it('Test D: date target only changes date', () => {
    const merged = applyDraftMerge(
      createIntent({
        projectHint: 'HERTZ',
        taskHint: 'QA',
        dateExpression: 'พรุ่งนี้',
        hours: 8,
        refersToPrevious: true,
      }),
      dateTargetDraft,
      undefined,
      { userMessage: 'พรุ่งนี้', now: FIXED_NOW }
    );
    expect(merged.intent.dateExpression).toBe('พรุ่งนี้');
    expect(merged.intent.projectHint).toBe('RMS');
    expect(merged.intent.taskHint).toBe('Project Management');
    expect(merged.intent.hours).toBe(3);
  });

  it('Test E: wrong-slot projectHint remaps to task only', () => {
    const merged = applyDraftMerge(
      createIntent({
        projectHint: 'PM',
        taskHint: null,
        dateExpression: 'พรุ่งนี้',
        hours: 8,
        refersToPrevious: true,
      }),
      taskTargetDraft,
      undefined,
      { userMessage: 'PM', now: FIXED_NOW }
    );
    expect(merged.intent.projectHint).toBe('RMS');
    expect(merged.intent.taskHint).toBe('PM');
    expect(merged.intent.hours).toBe(3);
    expect(merged.intent.dateExpression).toBe('2026-07-19');
  });

  it('Test F: wrong-slot taskHint remaps to project only', () => {
    const merged = applyDraftMerge(
      createIntent({
        projectHint: null,
        taskHint: 'RMS',
        dateExpression: 'พรุ่งนี้',
        hours: 8,
        refersToPrevious: true,
      }),
      projectTargetDraft,
      undefined,
      { userMessage: 'RMS', now: FIXED_NOW }
    );
    expect(merged.intent.projectHint).toBe('RMS');
    expect(merged.intent.taskHint).toBe('Project Management');
    expect(merged.intent.hours).toBe(3);
    expect(merged.intent.dateExpression).toBe('2026-07-19');
  });

  it('fill.taskHint wins and still protects trusted project', () => {
    const merged = applyDraftMerge(
      createIntent({
        projectHint: 'HERTZ',
        taskHint: null,
        refersToPrevious: true,
      }),
      taskTargetDraft,
      { taskHint: 'PM', matchedField: 'task' },
      { userMessage: 'PM', now: FIXED_NOW }
    );
    expect(merged.intent.projectHint).toBe('RMS');
    expect(merged.intent.taskHint).toBe('PM');
  });

  it('does not allow dual update from model fields during targeted clarification', () => {
    const merged = applyDraftMerge(
      createIntent({
        projectHint: 'HERTZ',
        taskHint: 'PM',
        dateExpression: 'พรุ่งนี้',
        hours: 8,
        refersToPrevious: true,
      }),
      taskTargetDraft,
      undefined,
      { userMessage: 'PM', now: FIXED_NOW }
    );
    expect(merged.intent.projectHint).toBe('RMS');
    expect(merged.intent.taskHint).toBe('PM');
    expect(merged.intent.hours).toBe(3);
    expect(merged.intent.dateExpression).toBe('2026-07-19');
    expect(merged.appliedField).toBe('task');
  });
});

describe('slot enrichment after create classification', () => {
  it('fills taskHint from เป็น PM when model omitted it', () => {
    const enriched = enrichWriteIntentSlots(
      createIntent({
        taskHint: null,
        missingFields: ['task'],
      }),
      'ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM',
      FIXED_NOW
    );
    expect(enriched.taskHint).toBe('PM');
    expect(enriched.projectHint).toBe('RMS');
    expect(enriched.hours).toBe(3);
  });
});

describe('production phrase → prepare (no clarification loop)', () => {
  it('complete first turn prepares create entry', async () => {
    const decision = await enforceStructuredIntent(
      createIntent({}),
      {
        now: FIXED_NOW,
        userMessage: 'ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM',
        draftStore: createInMemoryIntentDraftStore(),
        conversationId: 'C1',
        slackUserId: 'U1',
      }
    );
    expect(decision.action).toBe('call_tool');
    if (decision.action === 'call_tool') {
      expect(decision.toolName).toBe('prepare_create_timesheet_entry');
      expect(decision.arguments).toMatchObject({
        date: '2026-07-19',
        hours: 3,
        projectId: 'P-RMS',
        taskId: 'T-PM',
      });
    }
  });

  it('model omitting taskHint still prepares after enrichment', async () => {
    const decision = await enforceStructuredIntent(
      createIntent({ taskHint: null, missingFields: ['task'] }),
      {
        now: FIXED_NOW,
        userMessage: 'ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM',
        draftStore: createInMemoryIntentDraftStore(),
        conversationId: 'C1',
        slackUserId: 'U1',
      }
    );
    expect(decision.action).toBe('call_tool');
    if (decision.action === 'call_tool') {
      expect(decision.toolName).toBe('prepare_create_timesheet_entry');
      expect(decision.arguments.taskId).toBe('T-PM');
    }
  });

  it('screenshot loop: missing task then PM / Project Manager / RMS เป็น PM', async () => {
    const store = createInMemoryIntentDraftStore();
    const extractIntent = vi.fn(async ({ userMessage }: { userMessage: string }) => {
      const t = userMessage.trim();
      if (t.includes('ลงเวลางาน') && t.includes('RMS')) {
        // Simulate production: model misses taskHint
        return createIntent({
          taskHint: null,
          missingFields: ['task'],
        });
      }
      if (t === 'PM' || t === 'Project Manager') {
        return createIntent({
          intent: 'unknown',
          domain: 'unknown',
          dateExpression: null,
          projectHint: null,
          taskHint: null,
          hours: null,
          missingFields: [],
          refersToPrevious: false,
        });
      }
      if (t.includes('RMS') && t.includes('PM')) {
        return createIntent({
          taskHint: 'PM',
          projectHint: 'RMS',
          hours: null,
          dateExpression: null,
        });
      }
      return createIntent({ intent: 'general_conversation', domain: 'general' });
    });

    const first = await decideWithIntentExtraction(
      'ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM',
      {
        now: FIXED_NOW,
        extractIntent,
        draftStore: store,
        conversationId: 'C-loop',
        slackUserId: 'U1',
      }
    );
    // Enrichment should recover task from เป็น PM → prepare, not clarify
    expect(first.decision.action).toBe('call_tool');
    if (first.decision.action === 'call_tool') {
      expect(first.decision.toolName).toBe('prepare_create_timesheet_entry');
    }
  });

  it('follow-up PM merges into task-only draft without repeating generic clarify', async () => {
    const store = createInMemoryIntentDraftStore();
    // Seed incomplete draft as if first turn asked for task only
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-fu',
      slackUserId: 'U1',
      resolvedDate: '2026-07-19',
      projectHint: 'RMS',
      resolvedProjectId: 'P-RMS',
      hours: 3,
      missingFields: ['task'],
      lastClarificationField: 'task',
      clarificationCount: 1,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });

    const extractIntent = vi.fn(async () =>
      createIntent({
        intent: 'unknown',
        domain: 'unknown',
        dateExpression: null,
        projectHint: null,
        taskHint: null,
        hours: null,
        missingFields: [],
        refersToPrevious: false,
      })
    );

    const second = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent,
      draftStore: store,
      conversationId: 'C-fu',
      slackUserId: 'U1',
    });
    expect(second.decision.action).toBe('call_tool');
    if (second.decision.action === 'call_tool') {
      expect(second.decision.toolName).toBe('prepare_create_timesheet_entry');
      expect(second.decision.arguments.taskId).toBe('T-PM');
    }

    const third = await decideWithIntentExtraction('Project Manager', {
      now: FIXED_NOW,
      extractIntent,
      draftStore: store,
      conversationId: 'C-fu2',
      slackUserId: 'U1',
    });
    // New conversation draft empty — but for same draft conversation:
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-fu2',
      slackUserId: 'U1',
      resolvedDate: '2026-07-19',
      projectHint: 'RMS',
      resolvedProjectId: 'P-RMS',
      hours: 3,
      missingFields: ['task'],
      lastClarificationField: 'task',
      clarificationCount: 1,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const thirdB = await decideWithIntentExtraction('Project Manager', {
      now: FIXED_NOW,
      extractIntent,
      draftStore: store,
      conversationId: 'C-fu2',
      slackUserId: 'U1',
    });
    expect(thirdB.decision.action).toBe('call_tool');
    expect(third.decision.action).not.toBe('clarify');
  });

  it('misclassified projectHint=PM does not overwrite trusted RMS project', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-mis',
      slackUserId: 'U1',
      resolvedDate: '2026-07-19',
      projectHint: 'RMS',
      resolvedProjectId: 'P-RMS',
      hours: 3,
      missingFields: ['task'],
      lastClarificationField: 'task',
      clarificationCount: 1,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });

    // Exact production extractor mistake: answer "PM" lands in projectHint
    const extractIntent = async () =>
      createIntent({
        projectHint: 'PM',
        taskHint: null,
        dateExpression: null,
        hours: null,
        refersToPrevious: true,
        missingFields: [],
      });

    const result = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent,
      draftStore: store,
      conversationId: 'C-mis',
      slackUserId: 'U1',
    });

    expect(result.decision.action).toBe('call_tool');
    if (result.decision.action === 'call_tool') {
      expect(result.decision.toolName).toBe('prepare_create_timesheet_entry');
      expect(result.decision.arguments).toMatchObject({
        projectId: 'P-RMS',
        taskId: 'T-PM',
        hours: 3,
        date: '2026-07-19',
      });
    }
  });

  it('adversarial extractor cannot overwrite trusted non-target slots', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-adv',
      slackUserId: 'U1',
      resolvedDate: '2026-07-19',
      projectHint: 'RMS',
      resolvedProjectId: 'P-RMS',
      hours: 3,
      missingFields: ['task'],
      lastClarificationField: 'task',
      clarificationCount: 1,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });

    let prepareCalls = 0;
    const extractIntent = async () => {
      prepareCalls += 0; // extractor only
      return createIntent({
        projectHint: 'HERTZ',
        taskHint: 'PM',
        dateExpression: 'พรุ่งนี้',
        hours: 8,
        refersToPrevious: true,
        missingFields: [],
      });
    };

    const result = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent,
      draftStore: store,
      conversationId: 'C-adv',
      slackUserId: 'U1',
    });

    expect(result.decision.action).toBe('call_tool');
    if (result.decision.action === 'call_tool') {
      prepareCalls += 1;
      expect(result.decision.toolName).toBe('prepare_create_timesheet_entry');
      expect(result.decision.arguments).toEqual(
        expect.objectContaining({
          date: '2026-07-19',
          projectId: 'P-RMS',
          taskId: 'T-PM',
          hours: 3,
        })
      );
    }
    expect(prepareCalls).toBe(1);
    expect(result.decision.action).not.toBe('clarify');
  });

  it('general conversation does not mutate active draft slots', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-gen',
      slackUserId: 'U1',
      resolvedDate: '2026-07-19',
      projectHint: 'RMS',
      resolvedProjectId: 'P-RMS',
      hours: 3,
      missingFields: ['task'],
      lastClarificationField: 'task',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });

    for (const msg of ['ขอบคุณ', 'เล่าเรื่องแมว', 'What is a timesheet?']) {
      const result = await decideWithIntentExtraction(msg, {
        now: FIXED_NOW,
        extractIntent: async () =>
          createIntent({
            intent: 'general_conversation',
            domain: 'general',
            projectHint: 'HERTZ',
            taskHint: 'QA',
            hours: 8,
            dateExpression: 'พรุ่งนี้',
            refersToPrevious: false,
          }),
        draftStore: store,
        conversationId: 'C-gen',
        slackUserId: 'U1',
      });
      expect(result.decision.action).toBe('none');
      const draft = await store.get('C-gen', 'U1');
      expect(draft.outcome).toBe('draft_found');
      if (draft.outcome === 'draft_found') {
        expect(draft.draft.projectHint).toBe('RMS');
        expect(draft.draft.resolvedProjectId).toBe('P-RMS');
        expect(draft.draft.hours).toBe(3);
        expect(draft.draft.missingFields).toEqual(['task']);
      }
    }
  });

  it('repeated unknown task shows candidates instead of generic loop', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-nf',
      slackUserId: 'U1',
      resolvedDate: '2026-07-19',
      projectHint: 'RMS',
      resolvedProjectId: 'P-RMS',
      hours: 3,
      missingFields: ['task'],
      lastClarificationField: 'task',
      clarificationCount: 1,
      lastUserAnswerNorm: 'zzz',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });

    const extractIntent = async () =>
      createIntent({
        intent: 'unknown',
        domain: 'unknown',
        dateExpression: null,
        projectHint: null,
        taskHint: null,
        hours: null,
        missingFields: [],
      });

    const r1 = await decideWithIntentExtraction('ZZZUnknown', {
      now: FIXED_NOW,
      extractIntent,
      draftStore: store,
      conversationId: 'C-nf',
      slackUserId: 'U1',
    });
    expect(r1.decision.action).toBe('clarify');
    if (r1.decision.action === 'clarify') {
      expect(r1.decision.message).not.toBe('ต้องการลงงานอะไรครับ');
      expect(r1.decision.message).toMatch(/Task|Project Management|Development/i);
    }
  });
});

describe('general_conversation must not block outstanding-slot follow-up', () => {
  async function seedTaskDraft(
    store: ReturnType<typeof createInMemoryIntentDraftStore>,
    conversationId: string
  ) {
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId,
      slackUserId: 'U1',
      resolvedDate: '2026-07-19',
      projectHint: 'RMS',
      resolvedProjectId: 'P-RMS',
      hours: 3,
      missingFields: ['task'],
      lastClarificationField: 'task',
      clarificationCount: 1,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
  }

  const generalNoHints = (): StructuredIntent =>
    createIntent({
      domain: 'general',
      intent: 'general_conversation',
      dateExpression: null,
      projectHint: null,
      taskHint: null,
      hours: null,
      missingFields: [],
      refersToPrevious: false,
    });

  it('TEST 1: general_conversation for PM still prepares Task follow-up', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTaskDraft(store, 'C-g1');
    const result = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent: async () => generalNoHints(),
      draftStore: store,
      conversationId: 'C-g1',
      slackUserId: 'U1',
    });
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

  it('TEST 2: unknown for PM still prepares', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTaskDraft(store, 'C-g2');
    const result = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent: async () =>
        createIntent({
          intent: 'unknown',
          domain: 'unknown',
          dateExpression: null,
          projectHint: null,
          taskHint: null,
          hours: null,
          refersToPrevious: false,
        }),
      draftStore: store,
      conversationId: 'C-g2',
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

  it('TEST 3: Project Manager under general_conversation resolves to T-PM', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTaskDraft(store, 'C-g3');
    const result = await decideWithIntentExtraction('Project Manager', {
      now: FIXED_NOW,
      extractIntent: async () => generalNoHints(),
      draftStore: store,
      conversationId: 'C-g3',
      slackUserId: 'U1',
    });
    expect(result.decision.action).toBe('call_tool');
    if (result.decision.action === 'call_tool') {
      expect(result.decision.arguments.taskId).toBe('T-PM');
      expect(result.decision.arguments.projectId).toBe('P-RMS');
      expect(result.decision.arguments.hours).toBe(3);
    }
  });

  it('TEST 4: RMS under general_conversation fills Project only', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-g4',
      slackUserId: 'U1',
      resolvedDate: '2026-07-19',
      taskHint: 'Project Management',
      resolvedTaskId: 'T-PM',
      hours: 3,
      missingFields: ['project'],
      lastClarificationField: 'project',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const result = await decideWithIntentExtraction('RMS', {
      now: FIXED_NOW,
      extractIntent: async () => generalNoHints(),
      draftStore: store,
      conversationId: 'C-g4',
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

  it('TEST 5: hours follow-up under general_conversation', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-g5',
      slackUserId: 'U1',
      resolvedDate: '2026-07-19',
      projectHint: 'RMS',
      resolvedProjectId: 'P-RMS',
      taskHint: 'Project Management',
      resolvedTaskId: 'T-PM',
      missingFields: ['hours'],
      lastClarificationField: 'hours',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const result = await decideWithIntentExtraction('3', {
      now: FIXED_NOW,
      extractIntent: async () => generalNoHints(),
      draftStore: store,
      conversationId: 'C-g5',
      slackUserId: 'U1',
    });
    expect(result.decision.action).toBe('call_tool');
    if (result.decision.action === 'call_tool') {
      expect(result.decision.arguments).toMatchObject({
        hours: 3,
        projectId: 'P-RMS',
        taskId: 'T-PM',
        date: '2026-07-19',
      });
    }
  });

  it('TEST 6: date follow-up under general_conversation', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-g6',
      slackUserId: 'U1',
      projectHint: 'RMS',
      resolvedProjectId: 'P-RMS',
      taskHint: 'Project Management',
      resolvedTaskId: 'T-PM',
      hours: 3,
      missingFields: ['date'],
      lastClarificationField: 'date',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const result = await decideWithIntentExtraction('พรุ่งนี้', {
      now: FIXED_NOW,
      extractIntent: async () => generalNoHints(),
      draftStore: store,
      conversationId: 'C-g6',
      slackUserId: 'U1',
    });
    expect(result.decision.action).toBe('call_tool');
    if (result.decision.action === 'call_tool') {
      expect(result.decision.arguments).toMatchObject({
        date: '2026-07-20',
        projectId: 'P-RMS',
        taskId: 'T-PM',
        hours: 3,
      });
    }
  });

  it('TEST 7: known unrelated phrases preserve Draft', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTaskDraft(store, 'C-g7');
    for (const msg of [
      'ขอบคุณ',
      'เล่าเรื่องแมว',
      'What is a timesheet?',
      'ช่วยเขียน TypeScript',
    ]) {
      const result = await decideWithIntentExtraction(msg, {
        now: FIXED_NOW,
        extractIntent: async () => generalNoHints(),
        draftStore: store,
        conversationId: 'C-g7',
        slackUserId: 'U1',
      });
      expect(result.decision.action).toBe('none');
      const draft = await store.get('C-g7', 'U1');
      expect(draft.outcome).toBe('draft_found');
      if (draft.outcome === 'draft_found') {
        expect(draft.draft.missingFields).toEqual(['task']);
        expect(draft.draft.projectHint).toBe('RMS');
      }
    }
  });

  it('TEST 8: explicit cancellation clears Draft', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTaskDraft(store, 'C-g8');
    const result = await decideWithIntentExtraction('ไม่ลงเวลาแล้ว', {
      now: FIXED_NOW,
      extractIntent: async () => generalNoHints(),
      draftStore: store,
      conversationId: 'C-g8',
      slackUserId: 'U1',
    });
    expect(result.decision.action).toBe('clarify');
    expect(result.decision.reason).toBe('intent_draft_cancelled');
    expect((await store.get('C-g8', 'U1')).outcome).toBe('draft_not_found');
  });

  it('TEST 9: invalid hours structural answer re-clarifies hours', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-g9',
      slackUserId: 'U1',
      resolvedDate: '2026-07-19',
      projectHint: 'RMS',
      resolvedProjectId: 'P-RMS',
      taskHint: 'Project Management',
      resolvedTaskId: 'T-PM',
      missingFields: ['hours'],
      lastClarificationField: 'hours',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const result = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent: async () => generalNoHints(),
      draftStore: store,
      conversationId: 'C-g9',
      slackUserId: 'U1',
    });
    expect(result.decision.action).toBe('clarify');
    if (result.decision.action === 'clarify') {
      expect(result.decision.message).toMatch(/ชั่วโมง/);
      expect(result.decision.message).not.toBe('ต้องการลงงานอะไรครับ');
    }
    const draft = await store.get('C-g9', 'U1');
    expect(draft.outcome).toBe('draft_found');
    if (draft.outcome === 'draft_found') {
      expect(draft.draft.missingFields).toContain('hours');
      expect(draft.draft.taskHint).toBe('Project Management');
    }
  });

  it('TEST 10: invalid date structural answer re-clarifies date', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-g10',
      slackUserId: 'U1',
      projectHint: 'RMS',
      resolvedProjectId: 'P-RMS',
      taskHint: 'Project Management',
      resolvedTaskId: 'T-PM',
      hours: 3,
      missingFields: ['date'],
      lastClarificationField: 'date',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const result = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent: async () => generalNoHints(),
      draftStore: store,
      conversationId: 'C-g10',
      slackUserId: 'U1',
    });
    expect(result.decision.action).toBe('clarify');
    if (result.decision.action === 'clarify') {
      expect(result.decision.message).toMatch(/วันที่/);
    }
  });

  it('TEST 11: adversarial general_conversation fields still target raw PM', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTaskDraft(store, 'C-g11');
    const result = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent: async () =>
        createIntent({
          domain: 'general',
          intent: 'general_conversation',
          projectHint: 'HERTZ',
          taskHint: 'QA',
          dateExpression: 'พรุ่งนี้',
          hours: 8,
          refersToPrevious: false,
        }),
      draftStore: store,
      conversationId: 'C-g11',
      slackUserId: 'U1',
    });
    expect(result.decision.action).toBe('call_tool');
    if (result.decision.action === 'call_tool') {
      expect(result.decision.arguments).toMatchObject({
        date: '2026-07-19',
        projectId: 'P-RMS',
        taskId: 'T-PM',
        hours: 3,
      });
    }
  });

  it('TEST 12: screenshot-loop with general_conversation misclassifications', async () => {
    const store = createInMemoryIntentDraftStore();
    await seedTaskDraft(store, 'C-g12');

    const replies = [
      {
        msg: 'PM',
        extract: () => generalNoHints(),
      },
      {
        msg: 'Project Manager',
        extract: () =>
          createIntent({
            intent: 'unknown',
            domain: 'unknown',
            projectHint: null,
            taskHint: null,
            hours: null,
            dateExpression: null,
            refersToPrevious: false,
          }),
      },
    ];

    // First reply should prepare; draft cleared — re-seed for second misclassification style
    const first = await decideWithIntentExtraction(replies[0]!.msg, {
      now: FIXED_NOW,
      extractIntent: async () => replies[0]!.extract(),
      draftStore: store,
      conversationId: 'C-g12',
      slackUserId: 'U1',
    });
    expect(first.decision.action).toBe('call_tool');
    if (first.decision.action === 'call_tool') {
      expect(first.decision.toolName).toBe('prepare_create_timesheet_entry');
      expect(first.decision.arguments.projectId).toBe('P-RMS');
      expect(first.decision.arguments.taskId).toBe('T-PM');
    }

    await seedTaskDraft(store, 'C-g12b');
    const second = await decideWithIntentExtraction('RMS เป็น PM', {
      now: FIXED_NOW,
      extractIntent: async () =>
        createIntent({
          projectHint: 'HERTZ',
          taskHint: null,
          dateExpression: 'พรุ่งนี้',
          hours: 8,
          refersToPrevious: false,
          intent: 'general_conversation',
          domain: 'general',
        }),
      draftStore: store,
      conversationId: 'C-g12b',
      slackUserId: 'U1',
    });
    expect(second.decision.action).toBe('call_tool');
    if (second.decision.action === 'call_tool') {
      expect(second.decision.arguments.projectId).toBe('P-RMS');
      expect(second.decision.arguments.hours).toBe(3);
      expect(second.decision.arguments.date).toBe('2026-07-19');
      // Raw message used as task hint when outstanding is task
      expect(second.decision.arguments.taskId).toBe('T-PM');
    }
  });
});

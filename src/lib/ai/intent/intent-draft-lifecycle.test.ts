/**
 * Canonical Draft slot-completion and sequential correction lifecycle.
 */
import { describe, expect, it, vi } from 'vitest';

const eventStore = new Map<string, string>();

vi.mock('@/lib/redis', () => ({
  getRedisClient: () => ({
    async setNx(key: string, value: string) {
      if (eventStore.has(key)) return false;
      eventStore.set(key, value);
      return true;
    },
  }),
}));

import {
  decideWithIntentExtraction,
  createInMemoryIntentDraftStore,
  computeCanonicalCreateMissingFields,
  normalizeIntentDraft,
  isValidCreateHours,
  type StructuredIntent,
  type IntentDraft,
} from '@/lib/ai/intent';
import { wasEventProcessed } from '@/lib/timesheet-agent/conversation-state';
import type { Project, Task } from '@/types';

const FIXED_NOW = new Date('2026-07-18T17:00:00.000Z');

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

function intent(partial: Partial<StructuredIntent> = {}): StructuredIntent {
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

function taskDraft(id: string, extra: Partial<IntentDraft> = {}): IntentDraft {
  const now = new Date().toISOString();
  return {
    intent: 'create_timesheet_entry',
    conversationId: id,
    slackUserId: 'U1',
    resolvedDate: '2026-07-19',
    projectHint: 'RMS',
    resolvedProjectId: 'P-RMS',
    hours: 3,
    missingFields: ['task'],
    lastClarificationField: 'task',
    clarificationCount: 1,
    createdAt: now,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    ...extra,
  };
}

describe('computeCanonicalCreateMissingFields', () => {
  it('Project hint without ID means project missing', () => {
    expect(
      computeCanonicalCreateMissingFields({
        resolvedDate: '2026-07-19',
        hours: 3,
        projectHint: 'RMS',
        resolvedProjectId: undefined,
        taskHint: 'PM',
        resolvedTaskId: 'T-PM',
      })
    ).toEqual(['project']);
  });

  it('Project ID means project complete', () => {
    expect(
      computeCanonicalCreateMissingFields({
        resolvedDate: '2026-07-19',
        hours: 3,
        projectHint: 'RMS',
        resolvedProjectId: 'P-RMS',
        resolvedTaskId: 'T-PM',
      })
    ).toEqual([]);
  });

  it('Task hint without ID means task missing', () => {
    expect(
      computeCanonicalCreateMissingFields({
        resolvedDate: '2026-07-19',
        hours: 3,
        resolvedProjectId: 'P-RMS',
        taskHint: 'ZZZ',
        resolvedTaskId: undefined,
      })
    ).toEqual(['task']);
  });

  it('Task ID means task complete', () => {
    expect(
      computeCanonicalCreateMissingFields({
        resolvedDate: '2026-07-19',
        hours: 3,
        resolvedProjectId: 'P-RMS',
        taskHint: 'PM',
        resolvedTaskId: 'T-PM',
      })
    ).toEqual([]);
  });

  it('dateExpression without valid resolvedDate means date missing', () => {
    expect(
      computeCanonicalCreateMissingFields({
        resolvedDate: undefined,
        hours: 3,
        resolvedProjectId: 'P-RMS',
        resolvedTaskId: 'T-PM',
      })
    ).toEqual(['date']);
  });

  it('invalid hours means hours missing', () => {
    expect(isValidCreateHours(0)).toBe(false);
    expect(isValidCreateHours(NaN)).toBe(false);
    expect(
      computeCanonicalCreateMissingFields({
        resolvedDate: '2026-07-19',
        hours: 0,
        resolvedProjectId: 'P-RMS',
        resolvedTaskId: 'T-PM',
      })
    ).toEqual(['hours']);
  });
  it('all canonical fields complete means empty missingFields', () => {
    expect(
      computeCanonicalCreateMissingFields({
        resolvedDate: '2026-07-19',
        hours: 3,
        resolvedProjectId: 'P-RMS',
        resolvedTaskId: 'T-PM',
        projectHint: 'ignored',
        taskHint: 'ignored',
      })
    ).toEqual([]);
  });
});

describe('normalizeIntentDraft', () => {
  it('TEST 5: inconsistent Task Draft adds task to missingFields', () => {
    const draft = taskDraft('C-norm', {
      taskHint: 'ZZZ',
      resolvedTaskId: undefined,
      missingFields: [],
    });
    const normalized = normalizeIntentDraft(draft);
    expect(normalized.missingFields).toContain('task');
    expect(normalized.taskHint).toBe('ZZZ');
    expect(normalized.resolvedProjectId).toBe('P-RMS');
  });

  it('TEST 6: inconsistent Project Draft adds project', () => {
    const draft = taskDraft('C-norm-p', {
      projectHint: 'ZZZ',
      resolvedProjectId: undefined,
      taskHint: 'Project Management',
      resolvedTaskId: 'T-PM',
      missingFields: [],
    });
    const normalized = normalizeIntentDraft(draft);
    expect(normalized.missingFields).toContain('project');
    expect(normalized.projectHint).toBe('ZZZ');
  });

  it('TEST 9: dateExpression without resolvedDate adds date', () => {
    const draft = taskDraft('C-norm-d', {
      resolvedDate: undefined,
      dateExpression: 'เมื่อวาน',
      taskHint: 'PM',
      resolvedTaskId: 'T-PM',
      missingFields: [],
    });
    expect(normalizeIntentDraft(draft).missingFields).toContain('date');
  });

  it('TEST 10: invalid hours adds hours', () => {
    const draft = taskDraft('C-norm-h', {
      hours: 0,
      taskHint: 'PM',
      resolvedTaskId: 'T-PM',
      missingFields: [],
    });
    expect(normalizeIntentDraft(draft).missingFields).toContain('hours');
  });
});

describe('sequential Draft lifecycle', () => {
  it('TEST 1: Task not-found then PM correction prepares', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set(taskDraft('C-seq1'));

    const first = await decideWithIntentExtraction('ต่อจากเมื่อกี้ ใช้ ZZZ', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C-seq1',
      slackUserId: 'U1',
    });
    expect(first.decision.action).toBe('clarify');
    if (first.decision.action === 'clarify') {
      expect(first.decision.message).toMatch(/ยังไม่พบ Task|ZZZ/);
    }
    const afterFirst = await store.get('C-seq1', 'U1');
    expect(afterFirst.outcome).toBe('draft_found');
    if (afterFirst.outcome === 'draft_found') {
      expect(afterFirst.draft.taskHint).toBe('ZZZ');
      expect(afterFirst.draft.resolvedTaskId).toBeUndefined();
      expect(afterFirst.draft.missingFields).toContain('task');
      expect(afterFirst.draft.resolvedProjectId).toBe('P-RMS');
      expect(afterFirst.draft.hours).toBe(3);
      expect(afterFirst.draft.resolvedDate).toBe('2026-07-19');
      expect(afterFirst.draft.lastClarificationField).toBe('task');
      expect(afterFirst.draft.lastResolutionOutcome).toBe('not_found');
      expect(afterFirst.draft.clarificationCount).toBeGreaterThanOrEqual(2);
    }

    const second = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C-seq1',
      slackUserId: 'U1',
    });
    expect(second.decision.action).toBe('call_tool');
    if (second.decision.action === 'call_tool') {
      expect(second.decision.toolName).toBe('prepare_create_timesheet_entry');
      expect(second.decision.arguments).toMatchObject({
        date: '2026-07-19',
        projectId: 'P-RMS',
        taskId: 'T-PM',
        hours: 3,
      });
    }
    expect((await store.get('C-seq1', 'U1')).outcome).toBe('draft_not_found');
  });

  it('TEST 2: Task ambiguous then Project Management prepares', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set(taskDraft('C-seq2'));

    const first = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C-seq2',
      slackUserId: 'U1',
      resolveTaskFn: async () => ({
        status: 'ambiguous',
        candidates: [PM_TASK, PM_ALT],
      }),
    });
    expect(first.decision.action).toBe('clarify');
    const afterFirst = await store.get('C-seq2', 'U1');
    expect(afterFirst.outcome).toBe('draft_found');
    if (afterFirst.outcome === 'draft_found') {
      expect(afterFirst.draft.taskHint).toBe('PM');
      expect(afterFirst.draft.resolvedTaskId).toBeUndefined();
      expect(afterFirst.draft.missingFields).toContain('task');
      expect(afterFirst.draft.lastResolutionOutcome).toBe('ambiguous');
    }

    const second = await decideWithIntentExtraction('Project Management', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C-seq2',
      slackUserId: 'U1',
    });
    expect(second.decision.action).toBe('call_tool');
    if (second.decision.action === 'call_tool') {
      expect(second.decision.arguments.taskId).toBe('T-PM');
      expect(second.decision.arguments.projectId).toBe('P-RMS');
    }
  });

  it('TEST 4: Project ambiguous then RMS prepares', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set(
      taskDraft('C-seq4', {
        projectHint: undefined,
        resolvedProjectId: undefined,
        taskHint: 'Project Management',
        resolvedTaskId: 'T-PM',
        missingFields: ['project'],
        lastClarificationField: 'project',
      })
    );

    const first = await decideWithIntentExtraction('Commerce', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C-seq4',
      slackUserId: 'U1',
      resolveProjectFn: async () => ({
        status: 'ambiguous',
        candidates: [RMS, HERTZ],
      }),
    });
    expect(first.decision.action).toBe('clarify');
    const afterFirst = await store.get('C-seq4', 'U1');
    expect(afterFirst.outcome).toBe('draft_found');
    if (afterFirst.outcome === 'draft_found') {
      expect(afterFirst.draft.projectHint).toBe('Commerce');
      expect(afterFirst.draft.resolvedProjectId).toBeUndefined();
      expect(afterFirst.draft.missingFields).toContain('project');
      expect(afterFirst.draft.resolvedTaskId).toBe('T-PM');
      expect(afterFirst.draft.lastResolutionOutcome).toBe('ambiguous');
    }

    const second = await decideWithIntentExtraction('RMS', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C-seq4',
      slackUserId: 'U1',
    });
    expect(second.decision.action).toBe('call_tool');
    if (second.decision.action === 'call_tool') {
      expect(second.decision.arguments).toMatchObject({
        projectId: 'P-RMS',
        taskId: 'T-PM',
        hours: 3,
      });
    }
  });

  it('TEST 3: Project not-found then RMS prepares', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set(
      taskDraft('C-seq3', {
        projectHint: undefined,
        resolvedProjectId: undefined,
        taskHint: 'Project Management',
        resolvedTaskId: 'T-PM',
        missingFields: ['project'],
        lastClarificationField: 'project',
      })
    );

    const first = await decideWithIntentExtraction('ต่อจากเมื่อกี้ ใช้ ZZZ', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C-seq3',
      slackUserId: 'U1',
    });
    expect(first.decision.action).toBe('clarify');
    const afterFirst = await store.get('C-seq3', 'U1');
    expect(afterFirst.outcome).toBe('draft_found');
    if (afterFirst.outcome === 'draft_found') {
      expect(afterFirst.draft.missingFields).toContain('project');
      expect(afterFirst.draft.resolvedProjectId).toBeUndefined();
      expect(afterFirst.draft.resolvedTaskId).toBe('T-PM');
    }

    const second = await decideWithIntentExtraction('RMS', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C-seq3',
      slackUserId: 'U1',
    });
    expect(second.decision.action).toBe('call_tool');
    if (second.decision.action === 'call_tool') {
      expect(second.decision.arguments).toMatchObject({
        projectId: 'P-RMS',
        taskId: 'T-PM',
        hours: 3,
      });
    }
  });

  it('TEST 6 path: load inconsistent Project Draft then RMS prepares', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set(
      taskDraft('C-seq6', {
        projectHint: 'ZZZ',
        resolvedProjectId: undefined,
        taskHint: 'Project Management',
        resolvedTaskId: 'T-PM',
        missingFields: [],
      })
    );
    const loaded = await store.get('C-seq6', 'U1');
    expect(loaded.outcome).toBe('draft_found');
    if (loaded.outcome === 'draft_found') {
      expect(loaded.draft.missingFields).toContain('project');
      expect(loaded.draft.projectHint).toBe('ZZZ');
    }

    const result = await decideWithIntentExtraction('RMS', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C-seq6',
      slackUserId: 'U1',
    });
    expect(result.decision.action).toBe('call_tool');
    if (result.decision.action === 'call_tool') {
      expect(result.decision.arguments.projectId).toBe('P-RMS');
      expect(result.decision.arguments.taskId).toBe('T-PM');
    }
  });

  it('TEST 5 path: load inconsistent Draft then PM prepares', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set(
      taskDraft('C-seq5', {
        taskHint: 'ZZZ',
        resolvedTaskId: undefined,
        missingFields: [],
      })
    );
    const loaded = await store.get('C-seq5', 'U1');
    expect(loaded.outcome).toBe('draft_found');
    if (loaded.outcome === 'draft_found') {
      expect(loaded.draft.missingFields).toContain('task');
    }

    const result = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C-seq5',
      slackUserId: 'U1',
    });
    expect(result.decision.action).toBe('call_tool');
    if (result.decision.action === 'call_tool') {
      expect(result.decision.arguments.taskId).toBe('T-PM');
    }
  });

  it('TEST 7: hint-only with not_found cannot prepare', async () => {
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
            missingFields: [],
          }),
        draftStore: createInMemoryIntentDraftStore(),
        conversationId: 'C-seq7',
        slackUserId: 'U1',
        resolveTaskFn: async () => ({ status: 'not_found' }),
      }
    );
    expect(result.decision.action).toBe('clarify');
    expect(result.decision.action).not.toBe('call_tool');
  });

  it('TEST 8: resolver unavailable preserves Draft', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set(taskDraft('C-seq8'));
    const before = await store.get('C-seq8', 'U1');
    const result = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C-seq8',
      slackUserId: 'U1',
      resolveTaskFn: async () => {
        throw new Error('down');
      },
    });
    expect(result.decision.reason).toBe('master_data_unavailable');
    expect(await store.get('C-seq8', 'U1')).toEqual(before);
  });

  it('TEST 11: general after not-found preserves Task wait', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set(taskDraft('C-seq11'));
    await decideWithIntentExtraction('ต่อจากเมื่อกี้ ใช้ ZZZ', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C-seq11',
      slackUserId: 'U1',
    });
    const mid = await store.get('C-seq11', 'U1');
    const general = await decideWithIntentExtraction('อธิบาย microservice', {
      now: FIXED_NOW,
      extractIntent: async () =>
        intent({ intent: 'general_conversation', domain: 'general' }),
      draftStore: store,
      conversationId: 'C-seq11',
      slackUserId: 'U1',
    });
    expect(general.decision.action).toBe('none');
    const after = await store.get('C-seq11', 'U1');
    expect(after).toEqual(mid);
    if (after.outcome === 'draft_found') {
      expect(after.draft.taskHint).toBe('ZZZ');
      expect(after.draft.missingFields).toContain('task');
    }
  });

  it('TEST 12: duplicate Slack event_id is idempotent', async () => {
    const id = `Ev-lifecycle-pm-${Date.now()}`;
    expect(await wasEventProcessed(id)).toBe(false);
    expect(await wasEventProcessed(id)).toBe(true);
  });
});

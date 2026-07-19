import { describe, expect, it, vi } from 'vitest';
import {
  decideWithIntentExtraction,
  enforceStructuredIntent,
  createInMemoryIntentDraftStore,
  enrichWriteIntentSlots,
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

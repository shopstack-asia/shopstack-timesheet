import { describe, expect, it, vi } from 'vitest';
import {
  applyDraftMerge,
  createInMemoryIntentDraftStore,
  decideDraftMerge,
  decideWithIntentExtraction,
  enforceStructuredIntent,
  extractStructuredIntent,
  intentDraftKey,
  isUnrelatedGeneralPhrase,
  parseStructuredIntent,
  INTENT_EXTRACTION_SYSTEM_PROMPT,
  type StructuredIntent,
} from '@/lib/ai/intent';
import { enforceRequiredBusinessTool } from '@/lib/ai/conversation';
import type { GenerateResponseFn } from '@/lib/ai/types';
import type { Project, Task } from '@/types';

const FIXED_NOW = new Date('2026-07-18T17:00:00.000Z');

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

const resolveProjectFn = async (input: {
  projectId?: string;
  projectName?: string;
}) => {
  const hint = (input.projectName || '').toLowerCase();
  if (hint === 'rms') return { status: 'resolved' as const, value: RMS_PROJECT };
  if (hint === 'ambiguous') {
    return {
      status: 'ambiguous' as const,
      candidates: [RMS_PROJECT, { ...RMS_PROJECT, ProjectID: 'P2' }],
    };
  }
  return { status: 'not_found' as const };
};

const resolveTaskFn = async (input: {
  taskId?: string;
  taskName?: string;
}) => {
  const hint = (input.taskName || '').toLowerCase();
  if (hint === 'pm' || hint === 'project management') {
    return { status: 'resolved' as const, value: PM_TASK };
  }
  if (hint === 'ambiguous') {
    return {
      status: 'ambiguous' as const,
      candidates: [PM_TASK, { TaskID: 'T2', Task: 'Product Management' }],
    };
  }
  return { status: 'not_found' as const };
};

function createIntent(partial: Partial<StructuredIntent> = {}): StructuredIntent {
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

describe('draft key isolation', () => {
  it('includes conversationId and slackUserId', () => {
    const key = intentDraftKey('C1', 'U1');
    expect(key).toContain('timesheet:intent-draft:');
    expect(key).toContain(encodeURIComponent('C1'));
    expect(key).toContain(encodeURIComponent('U1'));
    expect(intentDraftKey('C1', 'U1')).not.toBe(intentDraftKey('C1', 'U2'));
    expect(intentDraftKey('C1', 'U1')).not.toBe(intentDraftKey('C2', 'U1'));
  });

  it('isolates drafts for two users in the same conversation', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-shared',
      slackUserId: 'UA',
      projectHint: 'RMS',
      missingFields: ['task', 'hours'],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-shared',
      slackUserId: 'UB',
      projectHint: 'OTHER',
      missingFields: ['task'],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });

    const a = await store.get('C-shared', 'UA');
    const b = await store.get('C-shared', 'UB');
    expect(a.outcome).toBe('draft_found');
    expect(b.outcome).toBe('draft_found');
    if (a.outcome === 'draft_found' && b.outcome === 'draft_found') {
      expect(a.draft.projectHint).toBe('RMS');
      expect(b.draft.projectHint).toBe('OTHER');
    }

    await store.clear('C-shared', 'UB');
    const aAfter = await store.get('C-shared', 'UA');
    const bAfter = await store.get('C-shared', 'UB');
    expect(aAfter.outcome).toBe('draft_found');
    expect(bAfter.outcome).toBe('draft_not_found');
  });

  it('same user has isolated drafts across conversations', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-A',
      slackUserId: 'U1',
      projectHint: 'A',
      missingFields: ['task'],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-B',
      slackUserId: 'U1',
      projectHint: 'B',
      missingFields: ['hours'],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const a = await store.get('C-A', 'U1');
    const b = await store.get('C-B', 'U1');
    expect(a.outcome === 'draft_found' && a.draft.projectHint).toBe('A');
    expect(b.outcome === 'draft_found' && b.draft.projectHint).toBe('B');
  });

  it('expires independently per scoped key', async () => {
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
});

describe('topic switching / no draft hijack', () => {
  it('does not treat ขอบคุณ / เล่าเรื่องแมว as missing-field fills', () => {
    expect(isUnrelatedGeneralPhrase('ขอบคุณ')).toBe(true);
    expect(isUnrelatedGeneralPhrase('เล่าเรื่องแมว')).toBe(true);
    expect(isUnrelatedGeneralPhrase('What is a timesheet?')).toBe(true);
    expect(isUnrelatedGeneralPhrase('PM')).toBe(false);
    expect(isUnrelatedGeneralPhrase('3 ชม.')).toBe(false);
  });

  it('general conversation with active draft remains general and preserves draft', async () => {
    const store = createInMemoryIntentDraftStore();
    await enforceStructuredIntent(
      createIntent({
        taskHint: null,
        hours: null,
        missingFields: ['task', 'hours'],
      }),
      {
        now: FIXED_NOW,
        draftStore: store,
        conversationId: 'C-gen',
        slackUserId: 'U1',
        resolveProjectFn,
        resolveTaskFn,
        userMessage: 'ลงเวลา RMS วันนี้',
      }
    );
    const before = await store.get('C-gen', 'U1');
    expect(before.outcome).toBe('draft_found');
    if (before.outcome !== 'draft_found') return;
    const projectBefore = before.draft.projectHint;

    const thanks = await enforceStructuredIntent(
      createIntent({
        domain: 'general',
        intent: 'general_conversation',
        dateExpression: null,
        projectHint: null,
        taskHint: null,
        hours: null,
        refersToPrevious: false,
      }),
      {
        now: FIXED_NOW,
        draft: before.draft,
        draftStore: store,
        conversationId: 'C-gen',
        slackUserId: 'U1',
        userMessage: 'ขอบคุณ',
        resolveProjectFn,
        resolveTaskFn,
      }
    );
    expect(thanks.action).toBe('none');
    expect(thanks.reason).toBe('general_conversation');

    const after = await store.get('C-gen', 'U1');
    expect(after.outcome).toBe('draft_found');
    if (after.outcome === 'draft_found') {
      expect(after.draft.projectHint).toBe(projectBefore);
      expect(after.draft.taskHint).toBeUndefined();
      expect(JSON.stringify(after.draft)).not.toMatch(/ขอบคุณ/);
    }

    const cat = await decideDraftMerge({
      intent: createIntent({
        domain: 'general',
        intent: 'general_conversation',
        refersToPrevious: false,
        projectHint: null,
        taskHint: null,
        hours: null,
        dateExpression: null,
      }),
      draft: before.draft,
      userMessage: 'เล่าเรื่องแมว',
      resolveProjectFn,
      resolveTaskFn,
    });
    expect(cat.merge).toBe(false);
  });

  it('explicit draft cancel clears draft; bare cancel prioritizes pending confirmation', async () => {
    const store = createInMemoryIntentDraftStore();
    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-cancel',
      slackUserId: 'U1',
      projectHint: 'RMS',
      missingFields: ['task'],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });

    const pendingFirst = await decideWithIntentExtraction('ยกเลิก', {
      now: FIXED_NOW,
      intentExtractionEnabled: true,
      extractIntent: async () =>
        createIntent({ intent: 'cancel_timesheet_change' }),
      draftStore: store,
      conversationId: 'C-cancel',
      slackUserId: 'U1',
      pendingChanges: [{ confirmationId: 'p1', summary: 'pending write' }],
    });
    expect(pendingFirst.decision.action).toBe('call_tool');
    if (pendingFirst.decision.action === 'call_tool') {
      expect(pendingFirst.decision.toolName).toBe('cancel_timesheet_change');
    }

    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-cancel2',
      slackUserId: 'U1',
      projectHint: 'RMS',
      missingFields: ['task'],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const draftCancel = await decideWithIntentExtraction('ยกเลิก', {
      now: FIXED_NOW,
      intentExtractionEnabled: true,
      extractIntent: async () =>
        createIntent({ intent: 'cancel_timesheet_change' }),
      draftStore: store,
      conversationId: 'C-cancel2',
      slackUserId: 'U1',
      pendingChanges: [],
    });
    expect(draftCancel.decision.reason).toBe('intent_draft_cancelled');
    expect((await store.get('C-cancel2', 'U1')).outcome).toBe('draft_not_found');

    await store.set({
      intent: 'create_timesheet_entry',
      conversationId: 'C-cancel3',
      slackUserId: 'U1',
      missingFields: ['task'],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const explicit = await decideWithIntentExtraction('ยกเลิกคำขอนี้', {
      now: FIXED_NOW,
      intentExtractionEnabled: true,
      extractIntent: async () =>
        createIntent({ intent: 'general_conversation' }),
      draftStore: store,
      conversationId: 'C-cancel3',
      slackUserId: 'U1',
    });
    expect(explicit.decision.reason).toBe('intent_draft_cancelled');
  });
});

describe('follow-up merge semantics', () => {
  it('multi-step PM then hours completes prepare_create', async () => {
    const store = createInMemoryIntentDraftStore();
    const first = await enforceStructuredIntent(
      createIntent({
        taskHint: null,
        hours: null,
        missingFields: ['task', 'hours'],
      }),
      {
        now: FIXED_NOW,
        draftStore: store,
        conversationId: 'C-fu',
        slackUserId: 'U1',
        resolveProjectFn,
        resolveTaskFn,
        userMessage: 'ลงเวลา RMS วันนี้',
      }
    );
    expect(first.action).toBe('clarify');

    const afterPm = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      intentExtractionEnabled: true,
      extractIntent: async () =>
        createIntent({
          taskHint: 'PM',
          hours: null,
          projectHint: null,
          dateExpression: null,
          refersToPrevious: true,
        }),
      draftStore: store,
      conversationId: 'C-fu',
      slackUserId: 'U1',
      resolveProjectFn,
      resolveTaskFn,
    });
    expect(afterPm.decision.action).toBe('clarify');
    if (afterPm.decision.action === 'clarify') {
      expect(afterPm.decision.message).toMatch(/ชั่วโมง/);
    }

    const afterHours = await decideWithIntentExtraction('3 ชม.', {
      now: FIXED_NOW,
      intentExtractionEnabled: true,
      extractIntent: async () =>
        createIntent({
          hours: 3,
          taskHint: null,
          projectHint: null,
          dateExpression: null,
          refersToPrevious: true,
        }),
      draftStore: store,
      conversationId: 'C-fu',
      slackUserId: 'U1',
      resolveProjectFn,
      resolveTaskFn,
    });
    expect(afterHours.decision.action).toBe('call_tool');
    if (afterHours.decision.action === 'call_tool') {
      expect(afterHours.decision.toolName).toBe(
        'prepare_create_timesheet_entry'
      );
      expect(afterHours.decision.arguments.taskId).toBe('T-PM');
      expect(afterHours.decision.arguments.hours).toBe(3);
    }
  });

  it('refersToPrevious=false does not merge unrelated text', async () => {
    const draft = {
      intent: 'create_timesheet_entry' as const,
      conversationId: 'C1',
      slackUserId: 'U1',
      projectHint: 'RMS',
      missingFields: ['task' as const],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
    const decision = await decideDraftMerge({
      intent: createIntent({
        intent: 'general_conversation',
        domain: 'general',
        refersToPrevious: false,
        taskHint: null,
        projectHint: null,
        hours: null,
        dateExpression: null,
      }),
      draft,
      userMessage: 'ขอบคุณ',
    });
    expect(decision.merge).toBe(false);
  });

  it('preserves draft intent when merging', () => {
    const draft = {
      intent: 'create_timesheet_entry' as const,
      conversationId: 'C1',
      slackUserId: 'U1',
      projectHint: 'RMS',
      resolvedDate: '2026-07-19',
      missingFields: ['task' as const],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
    const merged = applyDraftMerge(
      createIntent({
        intent: 'update_timesheet_entry',
        taskHint: 'PM',
        refersToPrevious: true,
      }),
      draft
    );
    expect(merged.intent).toBe('create_timesheet_entry');
    expect(merged.projectHint).toBe('RMS');
    expect(merged.taskHint).toBe('PM');
  });
});

describe('Redis draft failure', () => {
  it('complete request continues when draft get fails', async () => {
    const brokenStore = {
      get: async () =>
        ({ outcome: 'draft_store_unavailable' as const }),
      set: async () => ({ outcome: 'draft_saved' as const }),
      clear: async () => ({ outcome: 'draft_cleared' as const }),
    };
    const result = await decideWithIntentExtraction(
      'ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM',
      {
        now: FIXED_NOW,
        intentExtractionEnabled: true,
        extractIntent: async () => createIntent(),
        draftStore: brokenStore,
        conversationId: 'C-fail',
        slackUserId: 'U1',
        resolveProjectFn,
        resolveTaskFn,
      }
    );
    expect(result.decision.action).toBe('call_tool');
    expect(result.typedErrorCode).not.toBe('identity_unavailable');
    if (result.decision.action === 'call_tool') {
      expect(result.decision.toolName).toBe('prepare_create_timesheet_entry');
    }
  });

  it('incomplete request with set failure returns controlled clarification', async () => {
    const store = {
      get: async () => ({ outcome: 'draft_not_found' as const }),
      set: async () =>
        ({ outcome: 'draft_store_unavailable' as const }),
      clear: async () => ({ outcome: 'draft_cleared' as const }),
    };
    const result = await enforceStructuredIntent(
      createIntent({
        taskHint: null,
        hours: null,
        missingFields: ['task', 'hours'],
      }),
      {
        now: FIXED_NOW,
        draftStore: store,
        conversationId: 'C-set-fail',
        slackUserId: 'U1',
        resolveProjectFn,
        resolveTaskFn,
        userMessage: 'ลงเวลา RMS วันนี้',
      }
    );
    expect(result.action).toBe('clarify');
    if (result.action === 'clarify') {
      expect(result.reason).toBe('draft_store_unavailable');
      expect(result.message).toMatch(/ข้อความเดียว/);
      expect(result.message).not.toMatch(/identity|access/i);
    }
  });

  it('follow-up with Redis unavailable asks for complete request', async () => {
    const store = {
      get: async () =>
        ({ outcome: 'draft_store_unavailable' as const }),
      set: async () =>
        ({ outcome: 'draft_store_unavailable' as const }),
      clear: async () =>
        ({ outcome: 'draft_store_unavailable' as const }),
    };
    const result = await decideWithIntentExtraction('PM', {
      now: FIXED_NOW,
      intentExtractionEnabled: true,
      extractIntent: async () =>
        createIntent({
          taskHint: 'PM',
          refersToPrevious: true,
          hours: null,
          projectHint: null,
          dateExpression: null,
        }),
      draftStore: store,
      conversationId: 'C-fu-fail',
      slackUserId: 'U1',
      resolveProjectFn,
      resolveTaskFn,
    });
    expect(result.decision.action).toBe('clarify');
    expect(result.typedErrorCode).toBe('draft_store_unavailable');
    if (result.decision.action === 'clarify') {
      expect(result.decision.message).toBeTruthy();
      expect(result.decision.message).not.toMatch(/identity/i);
    }
  });
});

describe('production extractStructuredIntent boundary', () => {
  function mockGenerate(json: unknown): GenerateResponseFn {
    return async (input) => {
      expect(input.responseFormat).toBe('json_object');
      expect(input.temperature).toBe(0);
      const system = input.messages.find((m) => m.role === 'system');
      expect(system?.content).toContain('extract structured Timesheet');
      expect(INTENT_EXTRACTION_SYSTEM_PROMPT.length).toBeGreaterThan(100);
      return {
        text: typeof json === 'string' ? json : JSON.stringify(json),
        model: 'mock',
      };
    };
  }

  it('parses valid create JSON with production path', async () => {
    const intent = await extractStructuredIntent(
      { userMessage: 'ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM' },
      {
        generate: mockGenerate({
          domain: 'timesheet',
          intent: 'create_timesheet_entry',
          confidence: 'high',
          dateExpression: 'วันนี้',
          projectHint: 'RMS',
          taskHint: 'PM',
          hours: 3,
          missingFields: [],
          ambiguities: [],
          refersToPrevious: false,
        }),
      }
    );
    expect(intent.intent).toBe('create_timesheet_entry');
    expect(intent.projectHint).toBe('RMS');
    const decision = await enforceStructuredIntent(intent, {
      now: FIXED_NOW,
      resolveProjectFn,
      resolveTaskFn,
      userMessage: 'ลงเวลางาน RMS วันนี้ 3 ชม. เป็น PM',
    });
    expect(decision.action).toBe('call_tool');
  });

  it('keeps general conversation as no-tool', async () => {
    const intent = await extractStructuredIntent(
      { userMessage: 'ขอบคุณ' },
      {
        generate: mockGenerate({
          domain: 'general',
          intent: 'general_conversation',
          confidence: 'high',
          dateExpression: null,
          projectHint: null,
          taskHint: null,
          hours: null,
          missingFields: [],
          ambiguities: [],
          refersToPrevious: false,
        }),
      }
    );
    const decision = await enforceStructuredIntent(intent, {
      userMessage: 'ขอบคุณ',
    });
    expect(decision.action).toBe('none');
  });

  it('rejects invalid JSON, identity fields, and additional properties', async () => {
    await expect(
      extractStructuredIntent(
        { userMessage: 'x' },
        { generate: mockGenerate('not-json{') }
      )
    ).rejects.toThrow(/extraction_failed/);

    await expect(
      extractStructuredIntent(
        { userMessage: 'x' },
        { generate: async () => ({ text: '', model: 'm' }) }
      )
    ).rejects.toThrow(/extraction_failed/);

    await expect(
      extractStructuredIntent(
        { userMessage: 'x' },
        {
          generate: mockGenerate({
            domain: 'timesheet',
            intent: 'create_timesheet_entry',
            confidence: 'high',
            employeeId: 'S1',
            missingFields: [],
            ambiguities: [],
          }),
        }
      )
    ).rejects.toThrow(/forbidden identity|malformed_intent/);

    expect(() =>
      parseStructuredIntent({
        domain: 'timesheet',
        intent: 'create_timesheet_entry',
        confidence: 'high',
        missingFields: [],
        ambiguities: [],
        extraEvil: true,
      })
    ).toThrow();
  });

  it('wrong model tool cannot bypass enforcement', () => {
    const decision = {
      action: 'call_tool' as const,
      toolName: 'prepare_create_timesheet_entry' as const,
      arguments: { date: '2026-07-19', hours: 3, projectId: 'P-RMS', taskId: 'T-PM' },
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
    expect(enforced.toolCalls[0]!.function.name).toBe(
      'prepare_create_timesheet_entry'
    );
  });
});

/**
 * Sequential multi-pending selection persistence (PR #18 final blocker).
 * Exercises runConversation + real selection orchestration — not fixture bypasses.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runConversation } from '@/lib/ai/conversation';
import {
  createInMemorySelectedPendingStore,
  formatOwnedPendingChoices,
  routePendingResponse,
  selectedPendingKey,
  sortOwnedPendingForPresentation,
  type SelectedPendingStore,
} from '@/lib/ai/pending-response';
import { createInMemoryPendingTimesheetChangeStore } from '@/lib/timesheet/write/pending-store';
import { createDefaultToolRegistry, createToolRouter } from '@/lib/tools';
import type { PendingResponseExtraction } from '@/lib/ai/pending-response';
import type { PendingTimesheetChangeStore } from '@/lib/timesheet/write/pending-store';

function extraction(
  partial: Partial<PendingResponseExtraction> &
    Pick<PendingResponseExtraction, 'intent'>
): PendingResponseExtraction {
  return {
    confidence: 0.92,
    hasNewMutation: false,
    correction: null,
    reasonCode: 'test',
    ...partial,
  };
}

const ctxFor = (slackUserId: string, employeeId: string, conversationId = 'C1') =>
  async () =>
    ({
      conversationId,
      slackUserId,
      slackEmail: `${slackUserId}@shopstack.asia`,
      employeeId,
      loadedAt: new Date(),
    }) as never;

async function seedPending(
  store: PendingTimesheetChangeStore,
  opts: {
    id: string;
    employeeId?: string;
    slackUserId?: string;
    conversationId?: string;
    date?: string;
    projectName?: string;
    taskName?: string;
    hours?: number;
    ttlMs?: number;
  }
) {
  return store.create({
    confirmationId: opts.id,
    operation: 'create_entry',
    conversationId: opts.conversationId ?? 'C1',
    slackUserId: opts.slackUserId ?? 'U1',
    employeeId: opts.employeeId ?? 'S1',
    date: opts.date ?? '2026-07-20',
    originalSnapshot: { date: opts.date ?? '2026-07-20', entries: [] },
    originalSnapshotHash: 'h1',
    proposedSnapshot: { date: opts.date ?? '2026-07-20', entries: [] },
    proposedSnapshotHash: 'h2',
    summary: `summary ${opts.projectName ?? 'P'}`,
    summaryPayload: {
      date: opts.date ?? '2026-07-20',
      projectName: opts.projectName ?? 'Commerce Suite (Hertz)',
      taskName: opts.taskName ?? 'Development',
      hours: opts.hours ?? 3,
    },
    writeEntries: [
      {
        projectId: 'P1',
        taskId: 'T1',
        hours: opts.hours ?? 3,
      },
    ],
    ttlMs: opts.ttlMs ?? 600_000,
  });
}

async function seedHertzAndRms(store: PendingTimesheetChangeStore) {
  await seedPending(store, {
    id: 'confirm_hertz',
    projectName: 'Commerce Suite (Hertz)',
    taskName: 'Development',
    hours: 3,
    date: '2026-07-20',
  });
  await seedPending(store, {
    id: 'confirm_rms',
    projectName: 'RMS Portal',
    taskName: 'Project Management',
    hours: 3,
    date: '2026-07-20',
  });
}

function spyRegistry() {
  const confirmSpy = vi.fn(async (args: { confirmationId?: string }) => ({
    success: true as const,
    tool: 'confirm_timesheet_change',
    result: {
      status: 'completed',
      confirmationId: args.confirmationId ?? null,
      message: 'บันทึกเรียบร้อย',
    },
    durationMs: 1,
  }));
  const cancelSpy = vi.fn(async (args: { confirmationId?: string }) => ({
    success: true as const,
    tool: 'cancel_timesheet_change',
    result: {
      status: 'cancelled',
      confirmationId: args.confirmationId ?? null,
      message: 'ยกเลิกแล้ว',
    },
    durationMs: 1,
  }));
  const prepareSpy = vi.fn(async () => ({
    success: true as const,
    tool: 'prepare_create_timesheet_entry',
    result: {
      status: 'confirmation_required',
      confirmationMessage: 'ต้องการบันทึก…',
    },
    durationMs: 1,
  }));
  const writerSpy = vi.fn();

  const registry = createDefaultToolRegistry();
  registry.register({
    ...registry.get('confirm_timesheet_change')!,
    execute: async (input) =>
      confirmSpy(input as { confirmationId?: string }),
  });
  registry.register({
    ...registry.get('cancel_timesheet_change')!,
    execute: async (input) =>
      cancelSpy(input as { confirmationId?: string }),
  });
  registry.register({
    ...registry.get('prepare_create_timesheet_entry')!,
    execute: prepareSpy,
  });
  if (registry.exists('submit_day_timesheet')) {
    registry.register({
      ...registry.get('submit_day_timesheet')!,
      async execute() {
        writerSpy();
        return {
          success: true,
          tool: 'submit_day_timesheet',
          result: {},
          durationMs: 1,
        };
      },
    });
  }

  return {
    registry,
    router: createToolRouter(registry),
    confirmSpy,
    cancelSpy,
    prepareSpy,
    writerSpy,
  };
}

describe('multi-pending selection persistence (A–M)', () => {
  let pendingStore: ReturnType<typeof createInMemoryPendingTimesheetChangeStore>;
  let selectionStore: SelectedPendingStore;
  let nowMs: number;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    pendingStore = createInMemoryPendingTimesheetChangeStore();
    selectionStore = createInMemorySelectedPendingStore();
    nowMs = Date.now();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TEST A: select by project then confirm — selection persists across turns', async () => {
    await seedHertzAndRms(pendingStore);
    const tools = spyRegistry();
    let extractImpl: (input: {
      proposal: { projectName?: string };
    }) => Promise<{
      ok: true;
      extractorOutcome: 'extracted';
      extraction: PendingResponseExtraction;
    }> = async () => ({
      ok: true,
      extractorOutcome: 'extracted',
      extraction: extraction({ intent: 'ambiguous', confidence: 0.3 }),
    });
    const extractPending = vi.fn(async (input: {
      proposal: { projectName?: string };
    }) => extractImpl(input));

    // Turn 1: Hertz — selection only
    const t1 = await runConversation(
      {
        userMessage: 'Hertz',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: extractPending,
        decideWithIntent: async () => {
          throw new Error('intent must not run on selection');
        },
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    expect(t1.text).toMatch(/เลือกรายการนี้แล้ว|Selected:/i);
    expect(t1.text).toMatch(/Hertz/i);
    expect(tools.confirmSpy).not.toHaveBeenCalled();
    expect(tools.cancelSpy).not.toHaveBeenCalled();
    expect(tools.prepareSpy).not.toHaveBeenCalled();
    expect(tools.writerSpy).not.toHaveBeenCalled();
    const selected = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(selected.outcome).toBe('found');
    if (selected.outcome === 'found') {
      expect(selected.target.confirmationId).toBe('confirm_hertz');
    }

    // Turn 2: confirm
    extractPending.mockClear();
    extractImpl = async (input) => {
      expect(input.proposal.projectName).toMatch(/Hertz/i);
      return {
        ok: true,
        extractorOutcome: 'extracted',
        extraction: extraction({ intent: 'confirm', confidence: 0.96 }),
      };
    };

    await runConversation(
      {
        userMessage: 'ใช่ ถูกต้อง',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: extractPending,
        decideWithIntent: async () => {
          throw new Error('intent must not run');
        },
        generate: async () => ({ text: 'บันทึกเรียบร้อยแล้วครับ', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );

    expect(extractPending).toHaveBeenCalled();
    expect(tools.confirmSpy).toHaveBeenCalledTimes(1);
    expect(tools.confirmSpy.mock.calls[0]![0]?.confirmationId).toBe(
      'confirm_hertz'
    );
    expect(tools.writerSpy).not.toHaveBeenCalled(); // confirm tool stubbed; no direct writer
    const after = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(after.outcome).toBe('not_found');
  });

  it('TEST B: select by ordinal then confirm — snapshot ordinals stable', async () => {
    await seedHertzAndRms(pendingStore);
    const tools = spyRegistry();

    // Show choices first
    const listed = await routePendingResponse({
      userMessage: 'yes',
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore,
      selectionStore,
      getContext: ctxFor('U1', 'S1'),
      nowMs,
      extractPending: async () => {
        throw new Error('must not extract');
      },
    });
    expect(listed.handled).toBe(true);
    if (listed.handled) {
      expect(listed.enforcement.enforcementOutcome).toBe(
        'clarify_multiple_owned'
      );
      expect(String(listed.decision.action === 'clarify' ? listed.decision.message : '')).toMatch(
        /1\./
      );
    }

    const loaded = await pendingStore.findPendingByConversation('C1');
    const refs = loaded.map((c) => ({
      confirmationId: c.confirmationId,
      operation: c.operation,
      date: c.date,
      expiresAt: c.expiresAt.toISOString(),
      summaryPayload: c.summaryPayload,
      proposal: {
        operation: c.operation,
        date: c.date,
        projectName: String(c.summaryPayload.projectName ?? ''),
        taskName: String(c.summaryPayload.taskName ?? ''),
        hours: Number(c.summaryPayload.hours),
        summaryText: c.summary,
      },
    }));
    const ordered = sortOwnedPendingForPresentation(refs as never);
    const rmsOrdinal =
      ordered.findIndex((p) => p.confirmationId === 'confirm_rms') + 1;
    expect(rmsOrdinal).toBeGreaterThan(0);

    // Select ordinal for RMS
    const t1 = await runConversation(
      {
        userMessage: String(rmsOrdinal),
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'ambiguous', confidence: 0.4 }),
        }),
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    expect(t1.text).toMatch(/เลือกรายการนี้แล้ว|Selected:/i);
    expect(t1.text).toMatch(/RMS/i);
    expect(tools.confirmSpy).not.toHaveBeenCalled();

    const sel = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(sel.outcome).toBe('found');
    if (sel.outcome === 'found') {
      expect(sel.target.confirmationId).toBe('confirm_rms');
    }

    await runConversation(
      {
        userMessage: 'yes',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'confirm', confidence: 0.95 }),
        }),
        generate: async () => ({ text: 'done', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    expect(tools.confirmSpy).toHaveBeenCalledTimes(1);
    expect(tools.confirmSpy.mock.calls[0]![0]?.confirmationId).toBe(
      'confirm_rms'
    );
  });

  it('TEST C: select then cancel — only selected cancelled', async () => {
    await seedHertzAndRms(pendingStore);
    const tools = spyRegistry();

    await runConversation(
      {
        userMessage: 'Hertz',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'ambiguous', confidence: 0.3 }),
        }),
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );

    await runConversation(
      {
        userMessage: 'ไม่เอาแล้ว',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'cancel', confidence: 0.96 }),
        }),
        generate: async () => ({ text: 'ยกเลิกแล้วครับ', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );

    expect(tools.cancelSpy).toHaveBeenCalledTimes(1);
    expect(tools.cancelSpy.mock.calls[0]![0]?.confirmationId).toBe(
      'confirm_hertz'
    );
    expect(tools.confirmSpy).not.toHaveBeenCalled();
    expect(tools.writerSpy).not.toHaveBeenCalled();

    const remaining = await pendingStore.findPendingByConversation('C1');
    // cancel spy does not mutate store; assert RMS still pending via get
    const rms = await pendingStore.get('confirm_rms');
    expect(rms?.status).toBe('pending');

    const sel = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(sel.outcome).toBe('not_found');
    void remaining;
  });

  it('TEST D: select then correct — only selected superseded', async () => {
    await seedHertzAndRms(pendingStore);
    const tools = spyRegistry();
    const cancelledIds: string[] = [];

    await runConversation(
      {
        userMessage: 'RMS',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'ambiguous', confidence: 0.2 }),
        }),
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );

    await runConversation(
      {
        userMessage: 'เปลี่ยนเป็น 4 ชั่วโมง',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async (input) => {
          expect(input.proposal.projectName).toMatch(/RMS/i);
          return {
            ok: true,
            extractorOutcome: 'extracted',
            extraction: extraction({
              intent: 'correction',
              confidence: 0.95,
              hasNewMutation: true,
              correction: { hours: 4 },
            }),
          };
        },
        cancelPendingChange: async (_id, confirmationId) => {
          cancelledIds.push(String(confirmationId));
          await pendingStore.markCancelled(String(confirmationId));
          return {
            status: 'cancelled',
            confirmationId: String(confirmationId),
            message: 'ยกเลิกแล้ว',
          };
        },
        generate: async () => ({
          text: 'ต้องการบันทึกรายการนี้ใช่ไหมครับ',
          model: 'm',
        }),
        decisionNow: new Date(nowMs),
      }
    );

    expect(cancelledIds).toEqual(['confirm_rms']);
    expect(tools.prepareSpy).toHaveBeenCalledTimes(1);
    expect(tools.confirmSpy).not.toHaveBeenCalled();
    const hertz = await pendingStore.get('confirm_hertz');
    expect(hertz?.status).toBe('pending');
    const sel = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(sel.outcome).toBe('not_found');
  });

  it('TEST E: selection survives ambiguity then confirms', async () => {
    await seedHertzAndRms(pendingStore);
    const tools = spyRegistry();

    await runConversation(
      {
        userMessage: 'Hertz',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'ambiguous', confidence: 0.2 }),
        }),
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );

    const mid = await runConversation(
      {
        userMessage: 'เอ่อ ไม่แน่ใจ',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'ambiguous', confidence: 0.3 }),
        }),
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    expect(mid.text).toMatch(/ยืนยัน|confirm|ยกเลิก|cancel/i);
    const still = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(still.outcome).toBe('found');
    if (still.outcome === 'found') {
      expect(still.target.confirmationId).toBe('confirm_hertz');
    }

    await runConversation(
      {
        userMessage: 'ยืนยัน',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'confirm', confidence: 0.95 }),
        }),
        generate: async () => ({ text: 'done', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    expect(tools.confirmSpy.mock.calls[0]![0]?.confirmationId).toBe(
      'confirm_hertz'
    );
  });

  it('TEST F: selection survives unrelated chat', async () => {
    await seedHertzAndRms(pendingStore);
    const tools = spyRegistry();

    await runConversation(
      {
        userMessage: 'Hertz',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'ambiguous', confidence: 0.2 }),
        }),
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );

    await runConversation(
      {
        userMessage: 'วันนี้อากาศเป็นไงบ้าง',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'unrelated', confidence: 0.9 }),
        }),
        decideWithIntent: async () => ({
          decision: { action: 'none', reason: 'chat' },
          extractionOutcome: 'general_conversation',
        }),
        generate: async () => ({
          text: 'วันนี้อากาศดีครับ',
          model: 'm',
        }),
        decisionNow: new Date(nowMs),
      }
    );

    const still = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(still.outcome).toBe('found');
    if (still.outcome === 'found') {
      expect(still.target.confirmationId).toBe('confirm_hertz');
    }

    await runConversation(
      {
        userMessage: 'ใช่',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'confirm', confidence: 0.95 }),
        }),
        generate: async () => ({ text: 'done', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    expect(tools.confirmSpy.mock.calls[0]![0]?.confirmationId).toBe(
      'confirm_hertz'
    );
  });

  it('TEST G: selected record expires — clear, zero tools, controlled message', async () => {
    await seedPending(pendingStore, {
      id: 'confirm_hertz',
      projectName: 'Commerce Suite (Hertz)',
      ttlMs: 60_000,
    });
    await seedPending(pendingStore, {
      id: 'confirm_rms',
      projectName: 'RMS Portal',
      ttlMs: 60_000,
    });
    const tools = spyRegistry();

    await runConversation(
      {
        userMessage: 'Hertz',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'ambiguous', confidence: 0.2 }),
        }),
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );

    const later = nowMs + 120_000;
    const result = await runConversation(
      {
        userMessage: 'ใช่',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => {
          throw new Error('must not extract after expiry');
        },
        decideWithIntent: async () => ({
          decision: { action: 'none', reason: 'x' },
          extractionOutcome: 'general_conversation',
        }),
        generate: async () => ({ text: 'should not matter', model: 'm' }),
        decisionNow: new Date(later),
      }
    );

    expect(result.text).toMatch(/หมดอายุ|expired/i);
    expect(tools.confirmSpy).not.toHaveBeenCalled();
    expect(tools.cancelSpy).not.toHaveBeenCalled();
    expect(tools.prepareSpy).not.toHaveBeenCalled();
    const sel = await selectionStore.getSelected('C1', 'U1', 'S1', later);
    expect(sel.outcome).toBe('not_found');
  });

  it('TEST H: cross-user isolation', async () => {
    await seedHertzAndRms(pendingStore);
    // Also seed for U2
    await seedPending(pendingStore, {
      id: 'confirm_hertz_u2',
      slackUserId: 'U2',
      employeeId: 'S2',
      projectName: 'Commerce Suite (Hertz)',
    });
    await seedPending(pendingStore, {
      id: 'confirm_rms_u2',
      slackUserId: 'U2',
      employeeId: 'S2',
      projectName: 'RMS Portal',
    });
    const tools = spyRegistry();

    await runConversation(
      {
        userMessage: 'Hertz',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'ambiguous', confidence: 0.2 }),
        }),
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );

    const u1Sel = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(u1Sel.outcome).toBe('found');

    const u2Sel = await selectionStore.getSelected('C1', 'U2', 'S2', nowMs);
    expect(u2Sel.outcome).toBe('not_found');

    // U2 cannot use U1 selection key
    expect(selectedPendingKey('C1', 'U1')).not.toBe(
      selectedPendingKey('C1', 'U2')
    );

    const u2Turn = await runConversation(
      {
        userMessage: 'ใช่',
        conversationId: 'C1',
        metadata: { slackUserId: 'U2' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U2', 'S2'),
        extractPendingResponse: async () => {
          throw new Error('U2 must clarify multi-pending');
        },
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    expect(u2Turn.text).toMatch(/หลายรายการ|multiple pending/i);
    expect(tools.confirmSpy).not.toHaveBeenCalled();
  });

  it('TEST I: cross-conversation / employee isolation', async () => {
    await seedHertzAndRms(pendingStore);
    const tools = spyRegistry();

    await runConversation(
      {
        userMessage: 'Hertz',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1', 'C1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'ambiguous', confidence: 0.2 }),
        }),
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );

    // Wrong employeeId on get → rejected
    const wrongEmp = await selectionStore.getSelected('C1', 'U1', 'S_OTHER', nowMs);
    expect(wrongEmp.outcome).toBe('not_found');

    // Other conversation has no selection
    const otherConv = await selectionStore.getSelected('C9', 'U1', 'S1', nowMs);
    expect(otherConv.outcome).toBe('not_found');

    expect(tools.confirmSpy).not.toHaveBeenCalled();
  });

  it('TEST J: snapshot ordinal safety when new pending added', async () => {
    await seedHertzAndRms(pendingStore);
    const tools = spyRegistry();

    // Display choices → snapshot
    await routePendingResponse({
      userMessage: 'list',
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore,
      selectionStore,
      getContext: ctxFor('U1', 'S1'),
      nowMs,
      extractPending: async () => {
        throw new Error('no');
      },
    });

    const before = await pendingStore.findPendingByConversation('C1');
    const refs = before.map((c) => ({
      confirmationId: c.confirmationId,
      operation: c.operation,
      date: c.date,
      expiresAt: c.expiresAt.toISOString(),
      summaryPayload: c.summaryPayload,
      proposal: {
        operation: c.operation,
        date: c.date,
        projectName: String(c.summaryPayload.projectName ?? ''),
        taskName: String(c.summaryPayload.taskName ?? ''),
        hours: Number(c.summaryPayload.hours),
        summaryText: c.summary,
      },
    }));
    const { ordered } = formatOwnedPendingChoices(refs as never, 'list');
    const rmsOrdinal =
      ordered.findIndex((p) => p.confirmationId === 'confirm_rms') + 1;

    // Add a new pending that would change live sort order
    await seedPending(pendingStore, {
      id: 'confirm_alpha',
      projectName: 'AAA Early',
      date: '2026-07-19',
      hours: 1,
    });

    await runConversation(
      {
        userMessage: String(rmsOrdinal),
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'ambiguous', confidence: 0.2 }),
        }),
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );

    const sel = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(sel.outcome).toBe('found');
    if (sel.outcome === 'found') {
      expect(sel.target.confirmationId).toBe('confirm_rms');
    }

    // If RMS disappears → stale, re-list
    await pendingStore.markCancelled('confirm_rms');
    // Re-seed choices by listing again first
    const selectionStore2 = createInMemorySelectedPendingStore();
    await routePendingResponse({
      userMessage: 'list',
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore,
      selectionStore: selectionStore2,
      getContext: ctxFor('U1', 'S1'),
      nowMs,
      extractPending: async () => {
        throw new Error('no');
      },
    });
    // Manually put a stale snapshot pointing at cancelled RMS
    const staleSnap = {
      schemaVersion: 1 as const,
      conversationId: 'C1',
      slackUserId: 'U1',
      employeeId: 'S1',
      choices: [
        {
          ordinal: 1,
          confirmationId: 'confirm_hertz',
          safeFingerprint: 'x',
        },
        {
          ordinal: 2,
          confirmationId: 'confirm_rms',
          safeFingerprint: 'y',
        },
      ],
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 600_000).toISOString(),
    };
    await selectionStore2.setChoices(staleSnap, nowMs);

    const stale = await routePendingResponse({
      userMessage: '2',
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore,
      selectionStore: selectionStore2,
      getContext: ctxFor('U1', 'S1'),
      nowMs,
      extractPending: async () => {
        throw new Error('no action');
      },
    });
    expect(stale.handled).toBe(true);
    if (stale.handled) {
      expect(stale.enforcement.enforcementOutcome).toBe(
        'clarify_multiple_owned'
      );
    }
    expect(tools.confirmSpy).not.toHaveBeenCalled();
  });

  it('TEST K: invalid ordinal re-lists; zero tools', async () => {
    await seedHertzAndRms(pendingStore);
    const tools = spyRegistry();

    await routePendingResponse({
      userMessage: 'list',
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore,
      selectionStore,
      getContext: ctxFor('U1', 'S1'),
      nowMs,
      extractPending: async () => {
        throw new Error('no');
      },
    });

    const result = await runConversation(
      {
        userMessage: '3',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => {
          throw new Error('must not extract invalid ordinal');
        },
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    expect(result.text).toMatch(/หลายรายการ|multiple pending|1\./i);
    expect(tools.confirmSpy).not.toHaveBeenCalled();
    expect(tools.cancelSpy).not.toHaveBeenCalled();
    expect(tools.prepareSpy).not.toHaveBeenCalled();
  });

  it('TEST L: duplicate selection delivery is idempotent', async () => {
    await seedHertzAndRms(pendingStore);
    const tools = spyRegistry();

    for (let i = 0; i < 2; i++) {
      await runConversation(
        {
          userMessage: 'Hertz',
          conversationId: 'C1',
          metadata: { slackUserId: 'U1' },
        },
        {
          toolRegistry: tools.registry,
          toolRouter: tools.router,
          pendingStore,
          selectionStore,
          getContext: ctxFor('U1', 'S1'),
          extractPendingResponse: async () => ({
            ok: true,
            extractorOutcome: 'extracted',
            extraction: extraction({ intent: 'ambiguous', confidence: 0.2 }),
          }),
          generate: async () => ({ text: 'noop', model: 'm' }),
          decisionNow: new Date(nowMs),
        }
      );
    }

    const sel = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(sel.outcome).toBe('found');
    if (sel.outcome === 'found') {
      expect(sel.target.confirmationId).toBe('confirm_hertz');
    }
    expect(tools.confirmSpy).not.toHaveBeenCalled();

    // Duplicate confirm still one writer/confirm via tool
    await runConversation(
      {
        userMessage: 'ใช่',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'confirm', confidence: 0.95 }),
        }),
        generate: async () => ({ text: 'done', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    expect(tools.confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('TEST M: selection plus action in one message', async () => {
    await seedHertzAndRms(pendingStore);
    const tools = spyRegistry();

    // Confirm Hertz in one message
    await runConversation(
      {
        userMessage: 'ยืนยันรายการ Hertz',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async (input) => {
          expect(input.proposal.projectName).toMatch(/Hertz/i);
          return {
            ok: true,
            extractorOutcome: 'extracted',
            extraction: extraction({ intent: 'confirm', confidence: 0.95 }),
          };
        },
        generate: async () => ({ text: 'done', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    expect(tools.confirmSpy).toHaveBeenCalledTimes(1);
    expect(tools.confirmSpy.mock.calls[0]![0]?.confirmationId).toBe(
      'confirm_hertz'
    );

    // Fresh pair for cancel RMS
    const store2 = createInMemoryPendingTimesheetChangeStore();
    const sel2 = createInMemorySelectedPendingStore();
    await seedHertzAndRms(store2);
    tools.confirmSpy.mockClear();
    tools.cancelSpy.mockClear();

    await runConversation(
      {
        userMessage: 'cancel RMS',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore: store2,
        selectionStore: sel2,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async (input) => {
          expect(input.proposal.projectName).toMatch(/RMS/i);
          return {
            ok: true,
            extractorOutcome: 'extracted',
            extraction: extraction({ intent: 'cancel', confidence: 0.95 }),
          };
        },
        generate: async () => ({ text: 'cancelled', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    expect(tools.cancelSpy).toHaveBeenCalledTimes(1);
    expect(tools.cancelSpy.mock.calls[0]![0]?.confirmationId).toBe(
      'confirm_rms'
    );

    // Correction Hertz + low confidence clarifies
    const store3 = createInMemoryPendingTimesheetChangeStore();
    const sel3 = createInMemorySelectedPendingStore();
    await seedHertzAndRms(store3);
    tools.prepareSpy.mockClear();

    const low = await runConversation(
      {
        userMessage: 'แก้ Hertz เป็น 4 ชั่วโมง',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools.registry,
        toolRouter: tools.router,
        pendingStore: store3,
        selectionStore: sel3,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({
            intent: 'correction',
            confidence: 0.4,
            hasNewMutation: true,
            correction: { hours: 4 },
          }),
        }),
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    // Low confidence → selection persisted OR clarify — never prepare
    expect(tools.prepareSpy).not.toHaveBeenCalled();
    expect(low.text.length).toBeGreaterThan(0);
  });
});

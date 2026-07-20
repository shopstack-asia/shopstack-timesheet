/**
 * Final verified blockers for PR #18:
 * B1 LoadOwnedPendingResult none identity contract
 * B2 Selection clearing from authoritative business status
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runConversation } from '@/lib/ai/conversation';
import {
  createInMemorySelectedPendingStore,
  loadOwnedPendingChange,
  resolveSelectionAfterToolResult,
  routePendingResponse,
  type PendingResponseExtraction,
  type SelectedPendingStore,
} from '@/lib/ai/pending-response';
import { createInMemoryPendingTimesheetChangeStore } from '@/lib/timesheet/write/pending-store';
import { createDefaultToolRegistry, createToolRouter } from '@/lib/tools';
import type { ToolResult } from '@/lib/tools/types';
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

const ctxFor = (
  slackUserId: string,
  employeeId: string,
  conversationId = 'C1'
) =>
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
    projectName?: string;
    ttlMs?: number;
    status?: 'pending' | 'cancelled' | 'completed' | 'executing';
  }
) {
  const created = await store.create({
    confirmationId: opts.id,
    operation: 'create_entry',
    conversationId: opts.conversationId ?? 'C1',
    slackUserId: opts.slackUserId ?? 'U1',
    employeeId: opts.employeeId ?? 'S1',
    date: '2026-07-20',
    originalSnapshot: { date: '2026-07-20', entries: [] },
    originalSnapshotHash: 'h1',
    proposedSnapshot: { date: '2026-07-20', entries: [] },
    proposedSnapshotHash: 'h2',
    summary: `summary ${opts.projectName ?? 'Hertz'}`,
    summaryPayload: {
      date: '2026-07-20',
      projectName: opts.projectName ?? 'Commerce Suite (Hertz)',
      taskName: 'Development',
      hours: 3,
    },
    writeEntries: [{ projectId: 'P1', taskId: 'T1', hours: 3 }],
    ttlMs: opts.ttlMs ?? 600_000,
  });
  if (opts.status === 'cancelled') {
    await store.markCancelled(opts.id);
  } else if (opts.status === 'completed') {
    const claim = await store.claimForExecution(opts.id);
    if (claim) {
      await store.markCompleted(opts.id, claim.executionVersion, {
        resultSnapshotHash: 'done',
        completedResult: {
          status: 'completed',
          operation: 'create_entry',
          date: '2026-07-20',
          verified: { entries: [], totalHours: 3 },
          message: 'done',
        },
      });
    }
  } else if (opts.status === 'executing') {
    await store.claimForExecution(opts.id);
  }
  return created;
}

function toolOk(status: string): ToolResult {
  return {
    success: true,
    tool: 'confirm_timesheet_change',
    durationMs: 1,
    result: { status, message: 'x' },
  };
}

function toolFail(): ToolResult {
  return {
    success: false,
    tool: 'confirm_timesheet_change',
    durationMs: 1,
    errorCode: 'unexpected',
    errorMessage: 'boom',
  };
}

describe('B1: LoadOwnedPendingResult none identity contract', () => {
  it('context resolved + no pending → none includes trusted employeeId', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    const loaded = await loadOwnedPendingChange({
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore: store,
      getContext: ctxFor('U1', 'S1'),
    });
    expect(loaded.status).toBe('none');
    if (loaded.status === 'none') {
      expect(loaded.employeeId).toBe('S1');
      expect(loaded.reason).toBe('no_confirmable_pending');
    }
  });

  it('missing conversation/user IDs → none without employeeId', async () => {
    const loaded = await loadOwnedPendingChange({
      conversationId: '',
      slackUserId: '',
      pendingStore: createInMemoryPendingTimesheetChangeStore(),
      getContext: ctxFor('U1', 'S1'),
    });
    expect(loaded.status).toBe('none');
    if (loaded.status === 'none') {
      expect(loaded.employeeId).toBeUndefined();
      expect(loaded.reason).toBe('no_conversation_identity');
    }
  });

  it('context unavailable with no pending → none without employeeId (non-write may continue)', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    const loaded = await loadOwnedPendingChange({
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore: store,
      getContext: async () => {
        throw new Error('context down');
      },
    });
    expect(loaded.status).toBe('none');
    if (loaded.status === 'none') {
      expect(loaded.employeeId).toBeUndefined();
      expect(loaded.reason).toBe('no_confirmable_pending');
    }
  });

  it('context unavailable with existing pending → ownership failure', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await seedPending(store, { id: 'confirm_x' });
    const loaded = await loadOwnedPendingChange({
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore: store,
      getContext: async () => {
        throw new Error('context down');
      },
    });
    expect(loaded.status).toBe('context_unavailable');
  });

  it('selected target exists but pending expired → selection cleared, zero tools', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    const selectionStore = createInMemorySelectedPendingStore();
    await seedPending(store, { id: 'confirm_hertz', ttlMs: 60_000 });
    await seedPending(store, {
      id: 'confirm_rms',
      projectName: 'RMS Portal',
      ttlMs: 60_000,
    });
    const nowMs = Date.now();

    await routePendingResponse({
      userMessage: 'Hertz',
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore: store,
      selectionStore,
      getContext: ctxFor('U1', 'S1'),
      nowMs,
      extractPending: async () => ({
        ok: true,
        extractorOutcome: 'extracted',
        extraction: extraction({ intent: 'ambiguous', confidence: 0.2 }),
      }),
    });
    expect(
      (await selectionStore.getSelected('C1', 'U1', 'S1', nowMs)).outcome
    ).toBe('found');

    const later = nowMs + 120_000;
    const tools = createDefaultToolRegistry();
    const confirmSpy = vi.fn();
    tools.register({
      ...tools.get('confirm_timesheet_change')!,
      async execute() {
        confirmSpy();
        return toolOk('completed');
      },
    });

    const result = await runConversation(
      {
        userMessage: 'ใช่',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: tools,
        toolRouter: createToolRouter(tools),
        pendingStore: store,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => {
          throw new Error('must not extract');
        },
        decideWithIntent: async () => ({
          decision: { action: 'none', reason: 'x' },
          extractionOutcome: 'general_conversation',
        }),
        generate: async () => ({ text: 'noop', model: 'm' }),
        decisionNow: new Date(later),
      }
    );
    expect(result.text).toMatch(/หมดอายุ|expired/i);
    expect(confirmSpy).not.toHaveBeenCalled();
    const sel = await selectionStore.getSelected('C1', 'U1', 'S1', later);
    expect(sel.outcome).toBe('not_found');
  });

  it('selected target exists but pending cancelled → selection cleared, zero tools', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    const selectionStore = createInMemorySelectedPendingStore();
    await seedPending(store, { id: 'confirm_hertz' });
    await seedPending(store, {
      id: 'confirm_rms',
      projectName: 'RMS Portal',
    });
    const nowMs = Date.now();

    await routePendingResponse({
      userMessage: 'Hertz',
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore: store,
      selectionStore,
      getContext: ctxFor('U1', 'S1'),
      nowMs,
      extractPending: async () => ({
        ok: true,
        extractorOutcome: 'extracted',
        extraction: extraction({ intent: 'ambiguous', confidence: 0.2 }),
      }),
    });

    await store.markCancelled('confirm_hertz');
    await store.markCancelled('confirm_rms');

    const routed = await routePendingResponse({
      userMessage: 'ใช่',
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore: store,
      selectionStore,
      getContext: ctxFor('U1', 'S1'),
      nowMs,
      extractPending: async () => {
        throw new Error('must not extract');
      },
    });
    expect(routed.handled).toBe(true);
    if (routed.handled) {
      expect(routed.enforcement.enforcementOutcome).toBe('selection_expired');
    }
    const sel = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(sel.outcome).toBe('not_found');
  });

  it('wrong employee selected state → rejected/cleared', async () => {
    const selectionStore = createInMemorySelectedPendingStore();
    await selectionStore.setSelected(
      {
        schemaVersion: 1,
        conversationId: 'C1',
        slackUserId: 'U1',
        employeeId: 'S_OTHER',
        confirmationId: 'confirm_x',
        selectedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        selectionVersion: 1,
      },
      Date.now()
    );
    const got = await selectionStore.getSelected('C1', 'U1', 'S1', Date.now());
    expect(got.outcome).toBe('not_found');
  });
});

describe('B2: resolveSelectionAfterToolResult (authoritative business status)', () => {
  it('confirm statuses', () => {
    expect(
      resolveSelectionAfterToolResult({
        toolName: 'confirm_timesheet_change',
        toolResult: toolOk('completed'),
      }).action
    ).toBe('clear');
    expect(
      resolveSelectionAfterToolResult({
        toolName: 'confirm_timesheet_change',
        toolResult: toolOk('expired'),
      }).action
    ).toBe('clear_stale');
    expect(
      resolveSelectionAfterToolResult({
        toolName: 'confirm_timesheet_change',
        toolResult: toolOk('conflict'),
      }).action
    ).toBe('clear_stale');
    expect(
      resolveSelectionAfterToolResult({
        toolName: 'confirm_timesheet_change',
        toolResult: toolOk('already_processing'),
      }).action
    ).toBe('preserve');
    expect(
      resolveSelectionAfterToolResult({
        toolName: 'confirm_timesheet_change',
        toolResult: toolOk('unavailable'),
      }).action
    ).toBe('preserve');
    expect(
      resolveSelectionAfterToolResult({
        toolName: 'confirm_timesheet_change',
        toolResult: toolFail(),
      }).action
    ).toBe('preserve');
    expect(
      resolveSelectionAfterToolResult({
        toolName: 'confirm_timesheet_change',
        toolResult: {
          success: true,
          tool: 'confirm_timesheet_change',
          durationMs: 1,
          result: { message: 'no status' },
        },
      }).action
    ).toBe('preserve');
  });

  it('cancel statuses', () => {
    expect(
      resolveSelectionAfterToolResult({
        toolName: 'cancel_timesheet_change',
        toolResult: {
          success: true,
          tool: 'cancel_timesheet_change',
          durationMs: 1,
          result: { status: 'cancelled', message: 'ok' },
        },
      }).action
    ).toBe('clear');
    expect(
      resolveSelectionAfterToolResult({
        toolName: 'cancel_timesheet_change',
        toolResult: {
          success: true,
          tool: 'cancel_timesheet_change',
          durationMs: 1,
          result: { status: 'already_completed', message: 'ok' },
        },
      }).action
    ).toBe('clear_stale');
    expect(
      resolveSelectionAfterToolResult({
        toolName: 'cancel_timesheet_change',
        toolResult: {
          success: true,
          tool: 'cancel_timesheet_change',
          durationMs: 1,
          result: { status: 'expired', message: 'ok' },
        },
      }).action
    ).toBe('clear_stale');
    expect(
      resolveSelectionAfterToolResult({
        toolName: 'cancel_timesheet_change',
        toolResult: {
          success: true,
          tool: 'cancel_timesheet_change',
          durationMs: 1,
          result: { status: 'no_pending_change', message: 'ok' },
        },
      }).action
    ).toBe('preserve');
    expect(
      resolveSelectionAfterToolResult({
        toolName: 'cancel_timesheet_change',
        toolResult: {
          success: true,
          tool: 'cancel_timesheet_change',
          durationMs: 1,
          result: { status: 'unavailable', message: 'ok' },
        },
      }).action
    ).toBe('preserve');
    expect(
      resolveSelectionAfterToolResult({
        toolName: 'cancel_timesheet_change',
        toolResult: {
          success: false,
          tool: 'cancel_timesheet_change',
          durationMs: 1,
          errorCode: 'x',
        },
      }).action
    ).toBe('preserve');
  });
});

describe('B2 sequential: selection lifecycle via runConversation + real ToolResult envelope', () => {
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

  async function selectHertz() {
    await seedPending(pendingStore, {
      id: 'confirm_hertz',
      projectName: 'Commerce Suite (Hertz)',
    });
    await seedPending(pendingStore, {
      id: 'confirm_rms',
      projectName: 'RMS Portal',
    });
    await runConversation(
      {
        userMessage: 'Hertz',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
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
  }

  it('select Hertz → confirm completed → selection cleared', async () => {
    await selectHertz();
    const registry = createDefaultToolRegistry();
    registry.register({
      ...registry.get('confirm_timesheet_change')!,
      async execute() {
        return {
          success: true as const,
          tool: 'confirm_timesheet_change',
          durationMs: 1,
          result: {
            status: 'completed',
            operation: 'create_entry',
            date: '2026-07-20',
            verified: { entries: [], totalHours: 3 },
            message: 'done',
          },
        };
      },
    });

    await runConversation(
      {
        userMessage: 'ใช่',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'confirm', confidence: 0.95 }),
        }),
        generate: async () => ({ text: 'บันทึกแล้ว', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    const sel = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(sel.outcome).toBe('not_found');
  });

  it('select Hertz → confirm already_processing → selection remains', async () => {
    await selectHertz();
    const registry = createDefaultToolRegistry();
    registry.register({
      ...registry.get('confirm_timesheet_change')!,
      async execute() {
        return {
          success: true as const,
          tool: 'confirm_timesheet_change',
          durationMs: 1,
          result: { status: 'already_processing', message: 'busy' },
        };
      },
    });

    await runConversation(
      {
        userMessage: 'ใช่',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'confirm', confidence: 0.95 }),
        }),
        generate: async () => ({ text: 'กำลังดำเนินการ', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    const sel = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(sel.outcome).toBe('found');
    if (sel.outcome === 'found') {
      expect(sel.target.confirmationId).toBe('confirm_hertz');
    }
  });

  it('select Hertz → confirm unavailable → selection remains', async () => {
    await selectHertz();
    const registry = createDefaultToolRegistry();
    registry.register({
      ...registry.get('confirm_timesheet_change')!,
      async execute() {
        return {
          success: true as const,
          tool: 'confirm_timesheet_change',
          durationMs: 1,
          result: { status: 'unavailable', message: 'redis down' },
        };
      },
    });

    await runConversation(
      {
        userMessage: 'ใช่',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'confirm', confidence: 0.95 }),
        }),
        generate: async () => ({ text: 'unavailable', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    const sel = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(sel.outcome).toBe('found');
  });

  it('select RMS → cancel cancelled → selection cleared', async () => {
    await seedPending(pendingStore, {
      id: 'confirm_hertz',
      projectName: 'Commerce Suite (Hertz)',
    });
    await seedPending(pendingStore, {
      id: 'confirm_rms',
      projectName: 'RMS Portal',
    });
    await runConversation(
      {
        userMessage: 'RMS',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
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

    const registry = createDefaultToolRegistry();
    registry.register({
      ...registry.get('cancel_timesheet_change')!,
      async execute() {
        return {
          success: true as const,
          tool: 'cancel_timesheet_change',
          durationMs: 1,
          result: {
            status: 'cancelled',
            confirmationId: 'confirm_rms',
            message: 'ok',
          },
        };
      },
    });

    await runConversation(
      {
        userMessage: 'ไม่เอาแล้ว',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'cancel', confidence: 0.95 }),
        }),
        generate: async () => ({ text: 'ยกเลิกแล้ว', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    const sel = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(sel.outcome).toBe('not_found');
  });

  it('select RMS → cancel no_pending_change → selection remains', async () => {
    await seedPending(pendingStore, {
      id: 'confirm_hertz',
      projectName: 'Commerce Suite (Hertz)',
    });
    await seedPending(pendingStore, {
      id: 'confirm_rms',
      projectName: 'RMS Portal',
    });
    await runConversation(
      {
        userMessage: 'RMS',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
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

    const registry = createDefaultToolRegistry();
    registry.register({
      ...registry.get('cancel_timesheet_change')!,
      async execute() {
        return {
          success: true as const,
          tool: 'cancel_timesheet_change',
          durationMs: 1,
          result: { status: 'no_pending_change', message: 'race' },
        };
      },
    });

    await runConversation(
      {
        userMessage: 'ยกเลิก',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore,
        selectionStore,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'cancel', confidence: 0.95 }),
        }),
        generate: async () => ({ text: 'race', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    const sel = await selectionStore.getSelected('C1', 'U1', 'S1', nowMs);
    expect(sel.outcome).toBe('found');
  });

  it('cleanup Redis unavailable after completed write → write still completed; next turn repairs', async () => {
    await selectHertz();
    const registry = createDefaultToolRegistry();
    registry.register({
      ...registry.get('confirm_timesheet_change')!,
      async execute() {
        return {
          success: true as const,
          tool: 'confirm_timesheet_change',
          durationMs: 1,
          result: {
            status: 'completed',
            operation: 'create_entry',
            date: '2026-07-20',
            verified: { entries: [], totalHours: 3 },
            message: 'done',
          },
        };
      },
    });

    // Wrap selection store so clearAll fails after successful confirm
    const flaky: SelectedPendingStore = {
      ...selectionStore,
      async clearAll() {
        return { outcome: 'unavailable' };
      },
      getSelected: selectionStore.getSelected.bind(selectionStore),
      setSelected: selectionStore.setSelected.bind(selectionStore),
      clearSelected: selectionStore.clearSelected.bind(selectionStore),
      getChoices: selectionStore.getChoices.bind(selectionStore),
      setChoices: selectionStore.setChoices.bind(selectionStore),
      clearChoices: selectionStore.clearChoices.bind(selectionStore),
    };

    const result = await runConversation(
      {
        userMessage: 'ใช่',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore,
        selectionStore: flaky,
        getContext: ctxFor('U1', 'S1'),
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'confirm', confidence: 0.95 }),
        }),
        generate: async () => ({ text: 'บันทึกเรียบร้อยแล้วครับ', model: 'm' }),
        decisionNow: new Date(nowMs),
      }
    );
    expect(result.text).toMatch(/บันทึก/);

    // Authoritative pending gone → next turn clears stale navigation
    await pendingStore.markCancelled('confirm_hertz');
    await pendingStore.markCancelled('confirm_rms');
    const next = await routePendingResponse({
      userMessage: 'ใช่',
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
    expect(next.handled).toBe(true);
    if (next.handled) {
      expect(next.enforcement.enforcementOutcome).toBe('selection_expired');
    }
  });
});

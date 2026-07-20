/**
 * Production blockers for semantic pending-response (PR #18).
 * B1 multiple-owned, B2 correction cancel gate, B3 cancel confidence.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runConversation } from '@/lib/ai/conversation';
import {
  PENDING_ACTION_CONFIDENCE_THRESHOLD,
  enforcePendingResponse,
  isCancelAuthorized,
  loadOwnedPendingChange,
  resolveOwnedPendingSelection,
  routePendingResponse,
  gateCorrectionAfterCancel,
  type OwnedPendingRef,
  type PendingResponseExtraction,
} from '@/lib/ai/pending-response';
import { createInMemoryPendingTimesheetChangeStore } from '@/lib/timesheet/write/pending-store';
import { createDefaultToolRegistry, createToolRouter } from '@/lib/tools';
import type { CancelTimesheetChangeResult } from '@/lib/timesheet/write/pending-types';

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

function ownedRef(
  partial: Partial<OwnedPendingRef> & { confirmationId: string }
): OwnedPendingRef {
  return {
    operation: 'create_entry',
    date: '2026-07-18',
    summaryPayload: {
      date: '2026-07-18',
      projectName: 'Commerce Suite (HERTZ)',
      taskName: 'Development',
      hours: 5,
    },
    proposal: {
      operation: 'create_entry',
      date: '2026-07-18',
      projectName: 'Commerce Suite (HERTZ)',
      taskName: 'Development',
      hours: 5,
      summaryText: 'Hertz Development 5h',
    },
    ...partial,
  };
}

const ctx = async () =>
  ({
    conversationId: 'C1',
    slackUserId: 'U1',
    slackEmail: 'a@shopstack.asia',
    employeeId: 'S1',
    loadedAt: new Date(),
  }) as never;

async function seedPending(
  store: ReturnType<typeof createInMemoryPendingTimesheetChangeStore>,
  opts: {
    id: string;
    employeeId?: string;
    slackUserId?: string;
    conversationId?: string;
    date?: string;
    projectName?: string;
    taskName?: string;
    hours?: number;
    status?: 'pending' | 'cancelled' | 'completed' | 'executing';
    expiresAt?: Date;
  }
) {
  const created = await store.create({
    confirmationId: opts.id,
    operation: 'create_entry',
    conversationId: opts.conversationId ?? 'C1',
    slackUserId: opts.slackUserId ?? 'U1',
    employeeId: opts.employeeId ?? 'S1',
    date: opts.date ?? '2026-07-18',
    originalSnapshot: { date: opts.date ?? '2026-07-18', entries: [] },
    originalSnapshotHash: 'h1',
    proposedSnapshot: { date: opts.date ?? '2026-07-18', entries: [] },
    proposedSnapshotHash: 'h2',
    summary: `summary ${opts.projectName ?? 'P'}`,
    summaryPayload: {
      date: opts.date ?? '2026-07-18',
      projectName: opts.projectName ?? 'Commerce Suite (HERTZ)',
      taskName: opts.taskName ?? 'Development',
      hours: opts.hours ?? 5,
    },
    writeEntries: [{ projectId: 'P1', taskId: 'T1', hours: opts.hours ?? 5 }],
    ttlMs: 600_000,
  });
  if (opts.status && opts.status !== 'pending') {
    if (opts.status === 'cancelled') {
      await store.markCancelled(opts.id);
    } else if (opts.status === 'completed') {
      const claim = await store.claimForExecution(opts.id);
      if (claim) {
        await store.markCompleted(opts.id, claim.executionVersion, {
          resultSnapshotHash: 'done-hash',
          completedResult: {
            status: 'completed',
            operation: 'create_entry',
            date: opts.date ?? '2026-07-18',
            verified: { entries: [], totalHours: 5 },
            message: 'done',
          },
        });
      }
    } else if (opts.status === 'executing') {
      await store.claimForExecution(opts.id);
    }
  }
  if (opts.expiresAt) {
    // Force expiry via direct get+recreate is not available; use nowMs in load instead.
    void created;
  }
  return created;
}

describe('B1: multiple owned pending — never silent newest selection', () => {
  it('loadOwned returns multiple_owned without picking createdAt winner', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await seedPending(store, {
      id: 'confirm_old',
      projectName: 'RMS',
      date: '2026-07-17',
      hours: 3,
    });
    await seedPending(store, {
      id: 'confirm_new',
      projectName: 'HERTZ',
      date: '2026-07-18',
      hours: 5,
    });
    const loaded = await loadOwnedPendingChange({
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore: store,
      getContext: ctx,
    });
    expect(loaded.status).toBe('multiple_owned');
    if (loaded.status === 'multiple_owned') {
      expect(loaded.pending).toHaveLength(2);
      const ids = loaded.pending.map((p) => p.confirmationId).sort();
      expect(ids).toEqual(['confirm_new', 'confirm_old']);
    }
  });

  it('yes / cancel with two owned → clarification, zero tools', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await seedPending(store, { id: 'c1', projectName: 'RMS', hours: 3 });
    await seedPending(store, { id: 'c2', projectName: 'HERTZ', hours: 5 });

    for (const msg of ['yes', 'โอเค', 'cancel', 'ยกเลิก']) {
      const extractPending = vi.fn();
      const routed = await routePendingResponse({
        userMessage: msg,
        conversationId: 'C1',
        slackUserId: 'U1',
        pendingStore: store,
        getContext: ctx,
        extractPending,
      });
      expect(routed.handled).toBe(true);
      if (routed.handled) {
        expect(routed.decision.action).toBe('clarify');
        expect(routed.enforcement.enforcementOutcome).toBe(
          'clarify_multiple_owned'
        );
        expect(String(routed.decision.action === 'clarify' ? routed.decision.message : '')).not.toMatch(
          /confirm_|employeeId|S1|U1|executionVersion/
        );
      }
      expect(extractPending).not.toHaveBeenCalled();
    }
  });

  it('unique business-detail reply selects only that proposal', async () => {
    const a = ownedRef({
      confirmationId: 'c_rms',
      date: '2026-07-17',
      summaryPayload: {
        date: '2026-07-17',
        projectName: 'RMS Portal',
        taskName: 'PM',
        hours: 3,
      },
      proposal: {
        operation: 'create_entry',
        date: '2026-07-17',
        projectName: 'RMS Portal',
        taskName: 'PM',
        hours: 3,
        summaryText: 'RMS',
      },
    });
    const b = ownedRef({
      confirmationId: 'c_hertz',
      date: '2026-07-18',
      summaryPayload: {
        date: '2026-07-18',
        projectName: 'Commerce Suite (HERTZ)',
        taskName: 'Development',
        hours: 5,
      },
      proposal: {
        operation: 'create_entry',
        date: '2026-07-18',
        projectName: 'Commerce Suite (HERTZ)',
        taskName: 'Development',
        hours: 5,
        summaryText: 'Hertz',
      },
    });
    // Reverse array order vs createdAt — selection must ignore order
    const sel = resolveOwnedPendingSelection('HERTZ 2026-07-18 5 hours', [b, a]);
    expect(sel.status).toBe('unique');
    if (sel.status === 'unique') {
      expect(sel.pending.confirmationId).toBe('c_hertz');
    }

    const byTask = resolveOwnedPendingSelection('งาน PM', [b, a]);
    expect(byTask.status).toBe('unique');
    if (byTask.status === 'unique') {
      expect(byTask.pending.confirmationId).toBe('c_rms');
    }

    const none = resolveOwnedPendingSelection('yes please', [a, b]);
    expect(none.status).toBe('none');

    const amb = resolveOwnedPendingSelection('ชั่วโมง', [a, b]);
    // Generic word without distinctive business fields → none or ambiguous, never silent pick
    expect(['none', 'ambiguous']).toContain(amb.status);
  });

  it('excludes other employee / expired / non-pending', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await seedPending(store, { id: 'other_emp', employeeId: 'S999' });
    await seedPending(store, { id: 'ok', projectName: 'ONLY' });
    const loaded = await loadOwnedPendingChange({
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore: store,
      getContext: ctx,
    });
    expect(loaded.status).toBe('owned');
    if (loaded.status === 'owned') {
      expect(loaded.pending.confirmationId).toBe('ok');
    }

    const store2 = createInMemoryPendingTimesheetChangeStore();
    await seedPending(store2, { id: 'alive' });
    await seedPending(store2, { id: 'done' });
    await store2.markCancelled('done');
    const loaded2 = await loadOwnedPendingChange({
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore: store2,
      getContext: ctx,
    });
    expect(loaded2.status).toBe('owned');

    // Expired via nowMs in the future past TTL
    const store3 = createInMemoryPendingTimesheetChangeStore();
    await seedPending(store3, { id: 'stale' });
    const loaded3 = await loadOwnedPendingChange({
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore: store3,
      getContext: ctx,
      nowMs: Date.now() + 11 * 60 * 1000,
    });
    expect(loaded3.status).toBe('none');
  });
});

describe('B3: cancel confidence / conflict gates', () => {
  const pending = ownedRef({ confirmationId: 'confirm_c' });

  it('high-confidence cancel authorizes', () => {
    expect(
      isCancelAuthorized(
        extraction({ intent: 'cancel', confidence: 0.99 })
      ).ok
    ).toBe(true);
    const r = enforcePendingResponse({
      userMessage: 'ไม่เอาแล้ว',
      extraction: extraction({ intent: 'cancel', confidence: 0.99 }),
      ownedPending: pending,
    });
    expect(r.enforcementOutcome).toBe('cancel_authorized');
  });

  it('low confidence cancel → clarify, no cancel tool', () => {
    const r = enforcePendingResponse({
      userMessage: 'อาจจะยกเลิก?',
      extraction: extraction({
        intent: 'cancel',
        confidence: 0.2,
      }),
      ownedPending: pending,
    });
    expect(r.enforcementOutcome).toBe('clarify_low_confidence');
    expect(r.decision.action).toBe('clarify');
  });

  it('cancel + mutation/correction → clarify', () => {
    expect(
      enforcePendingResponse({
        userMessage: 'ยกเลิกแล้วเปลี่ยนเป็น 3 ชม',
        extraction: extraction({
          intent: 'cancel',
          confidence: 0.99,
          hasNewMutation: true,
        }),
        ownedPending: pending,
      }).enforcementOutcome
    ).toBe('clarify_conflict');

    expect(
      enforcePendingResponse({
        userMessage: 'ยกเลิกแต่เอา 3 ชม',
        extraction: extraction({
          intent: 'cancel',
          confidence: 0.99,
          correction: { hours: 3 },
        }),
        ownedPending: pending,
      }).enforcementOutcome
    ).toBe('clarify_conflict');
  });

  it('ambiguous intent never cancels', () => {
    const r = enforcePendingResponse({
      userMessage: 'ยกเลิก... หรือว่าโอเค?',
      extraction: extraction({ intent: 'ambiguous', confidence: 0.4 }),
      ownedPending: pending,
    });
    expect(r.enforcementOutcome).toBe('clarify_ambiguous');
  });
});

describe('B2: correction cancel-result gate', () => {
  it('exhaustive statuses: only cancelled proceeds', () => {
    expect(
      gateCorrectionAfterCancel(
        { status: 'cancelled', confirmationId: 'c1', message: 'ok' },
        'เปลี่ยนเป็น 3'
      ).proceed
    ).toBe(true);

    for (const status of [
      'already_completed',
      'no_pending_change',
      'expired',
      'unavailable',
    ] as const) {
      const gate = gateCorrectionAfterCancel(
        { status, message: 'x' } as CancelTimesheetChangeResult,
        'เปลี่ยนเป็น 3'
      );
      expect(gate.proceed).toBe(false);
    }
  });
});

describe('production-path runConversation blockers', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('exactly one owned + high-confidence confirm → confirm once', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await seedPending(store, { id: 'confirm_live' });
    const confirmSpy = vi.fn(async () => ({
      success: true as const,
      tool: 'confirm_timesheet_change',
      result: {
        status: 'completed',
        message: 'บันทึกเรียบร้อย',
      },
      durationMs: 1,
    }));
    const registry = createDefaultToolRegistry();
    registry.register({
      ...registry.get('confirm_timesheet_change')!,
      execute: confirmSpy,
    });

    await runConversation(
      {
        userMessage: 'โอเค ตามนั้นเลย',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore: store,
        getContext: ctx,
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'confirm', confidence: 0.95 }),
        }),
        decideWithIntent: async () => {
          throw new Error('should not run');
        },
        generate: async () => ({ text: 'บันทึกเรียบร้อยแล้วครับ', model: 'm' }),
      }
    );
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('exactly one owned + high-confidence cancel → cancel once, zero writer', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await seedPending(store, { id: 'confirm_c' });
    const cancelSpy = vi.fn(async () => ({
      success: true as const,
      tool: 'cancel_timesheet_change',
      result: { status: 'cancelled', message: 'ยกเลิกแล้ว' },
      durationMs: 1,
    }));
    const confirmSpy = vi.fn();
    const registry = createDefaultToolRegistry();
    registry.register({
      ...registry.get('cancel_timesheet_change')!,
      execute: cancelSpy,
    });
    registry.register({
      ...registry.get('confirm_timesheet_change')!,
      async execute() {
        confirmSpy();
        return {
          success: true,
          tool: 'confirm_timesheet_change',
          result: {},
          durationMs: 1,
        };
      },
    });

    await runConversation(
      {
        userMessage: 'ไม่เอาแล้วครับ',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore: store,
        getContext: ctx,
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'cancel', confidence: 0.96 }),
        }),
        decideWithIntent: async () => {
          throw new Error('should not run');
        },
        generate: async () => ({ text: 'ยกเลิกแล้วครับ', model: 'm' }),
      }
    );
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('multiple owned → zero confirm/cancel/prepare', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await seedPending(store, { id: 'a', projectName: 'RMS' });
    await seedPending(store, { id: 'b', projectName: 'HERTZ' });
    const confirmSpy = vi.fn();
    const cancelSpy = vi.fn();
    const prepareSpy = vi.fn();
    const registry = createDefaultToolRegistry();
    for (const [name, spy] of [
      ['confirm_timesheet_change', confirmSpy],
      ['cancel_timesheet_change', cancelSpy],
      ['prepare_create_timesheet_entry', prepareSpy],
    ] as const) {
      registry.register({
        ...registry.get(name)!,
        async execute() {
          spy();
          return {
            success: true,
            tool: name,
            result: {},
            durationMs: 1,
          };
        },
      });
    }

    const result = await runConversation(
      {
        userMessage: 'yes',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore: store,
        getContext: ctx,
        extractPendingResponse: async () => {
          throw new Error('extractor must not run for ambiguous multi-pending');
        },
        generate: async () => ({ text: 'should not matter', model: 'm' }),
      }
    );
    expect(result.text).toMatch(/หลายรายการ|multiple pending/i);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(prepareSpy).not.toHaveBeenCalled();
  });

  it('correction prepares only after cancel status cancelled', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await seedPending(store, { id: 'confirm_corr' });
    const prepareSpy = vi.fn(async () => ({
      success: true as const,
      tool: 'prepare_create_timesheet_entry',
      result: {
        status: 'confirmation_required',
        confirmationMessage: 'ต้องการบันทึก…',
      },
      durationMs: 1,
    }));
    const registry = createDefaultToolRegistry();
    registry.register({
      ...registry.get('prepare_create_timesheet_entry')!,
      execute: prepareSpy,
    });

    await runConversation(
      {
        userMessage: 'เปลี่ยนเป็น 3 ชั่วโมง',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore: store,
        getContext: ctx,
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({
            intent: 'correction',
            confidence: 0.95,
            hasNewMutation: true,
            correction: { hours: 3 },
          }),
        }),
        cancelPendingChange: async () => ({
          status: 'cancelled',
          confirmationId: 'confirm_corr',
          message: 'ยกเลิกแล้ว',
        }),
        generate: async () => ({
          text: 'ต้องการบันทึกรายการนี้ใช่ไหมครับ',
          model: 'm',
        }),
      }
    );
    expect(prepareSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    'already_completed',
    'expired',
    'unavailable',
    'no_pending_change',
  ] as const)(
    'correction with cancel=%s → zero prepare',
    async (status) => {
      const store = createInMemoryPendingTimesheetChangeStore();
      await seedPending(store, { id: 'confirm_corr2' });
      const prepareSpy = vi.fn();
      const registry = createDefaultToolRegistry();
      registry.register({
        ...registry.get('prepare_create_timesheet_entry')!,
        async execute() {
          prepareSpy();
          return {
            success: true,
            tool: 'prepare_create_timesheet_entry',
            result: {},
            durationMs: 1,
          };
        },
      });

      const result = await runConversation(
        {
          userMessage: 'เปลี่ยนเป็น 3 ชั่วโมง',
          conversationId: 'C1',
          metadata: { slackUserId: 'U1' },
        },
        {
          toolRegistry: registry,
          toolRouter: createToolRouter(registry),
          pendingStore: store,
          getContext: ctx,
          extractPendingResponse: async () => ({
            ok: true,
            extractorOutcome: 'extracted',
            extraction: extraction({
              intent: 'correction',
              confidence: 0.95,
              hasNewMutation: true,
              correction: { hours: 3 },
            }),
          }),
          cancelPendingChange: async () =>
            ({ status, message: 'blocked' }) as CancelTimesheetChangeResult,
          generate: async () => ({ text: 'should not prepare', model: 'm' }),
        }
      );
      expect(prepareSpy).not.toHaveBeenCalled();
      expect(result.toolRounds).toBe(0);
      expect(result.text.length).toBeGreaterThan(10);
    }
  );

  it('cancel throw → fail closed, zero prepare', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await seedPending(store, { id: 'confirm_corr3' });
    const prepareSpy = vi.fn();
    const registry = createDefaultToolRegistry();
    registry.register({
      ...registry.get('prepare_create_timesheet_entry')!,
      async execute() {
        prepareSpy();
        return {
          success: true,
          tool: 'prepare_create_timesheet_entry',
          result: {},
          durationMs: 1,
        };
      },
    });

    await runConversation(
      {
        userMessage: 'เปลี่ยนเป็น 3 ชั่วโมง',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore: store,
        getContext: ctx,
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({
            intent: 'correction',
            confidence: 0.95,
            hasNewMutation: true,
            correction: { hours: 3 },
          }),
        }),
        cancelPendingChange: async () => {
          throw new Error('redis boom');
        },
        generate: async () => ({ text: 'x', model: 'm' }),
      }
    );
    expect(prepareSpy).not.toHaveBeenCalled();
  });

  it('low-confidence cancel preserves pending (zero cancel tool)', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await seedPending(store, { id: 'confirm_low' });
    const cancelSpy = vi.fn();
    const registry = createDefaultToolRegistry();
    registry.register({
      ...registry.get('cancel_timesheet_change')!,
      async execute() {
        cancelSpy();
        return {
          success: true,
          tool: 'cancel_timesheet_change',
          result: {},
          durationMs: 1,
        };
      },
    });

    const result = await runConversation(
      {
        userMessage: 'ยกเลิกมั้ยนะ',
        conversationId: 'C1',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore: store,
        getContext: ctx,
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({
            intent: 'cancel',
            confidence: PENDING_ACTION_CONFIDENCE_THRESHOLD - 0.5,
          }),
        }),
        generate: async () => ({ text: 'clarify', model: 'm' }),
      }
    );
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(result.toolRounds).toBe(0);
    expect(await store.get('confirm_low')).toMatchObject({ status: 'pending' });
  });

  it('no owned pending: acknowledgement cannot confirm', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    const confirmSpy = vi.fn();
    const registry = createDefaultToolRegistry();
    registry.register({
      ...registry.get('confirm_timesheet_change')!,
      async execute() {
        confirmSpy();
        return {
          success: true,
          tool: 'confirm_timesheet_change',
          result: {},
          durationMs: 1,
        };
      },
    });

    await runConversation(
      {
        userMessage: 'ยืนยัน',
        conversationId: 'C-none',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore: store,
        getContext: ctx,
        extractIntent: async () => ({
          domain: 'general',
          intent: 'general_conversation',
          confidence: 'high',
          missingFields: [],
          ambiguities: [],
        }),
        generate: async () => ({
          text: 'มีอะไรให้ช่วยไหมครับ',
          model: 'm',
        }),
      }
    );
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

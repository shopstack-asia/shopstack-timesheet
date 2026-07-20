/**
 * Semantic pending-response extraction + enforcement tests (requirements A–L).
 * Behavioral fixtures are examples only — not a production allow-list.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runConversation } from '@/lib/ai/conversation';
import {
  parsePendingResponseExtraction,
  PENDING_CONFIRM_CONFIDENCE_THRESHOLD,
  enforcePendingResponse,
  enforceExtractorFailure,
  isConfirmAuthorized,
  extractPendingResponse,
  routePendingResponse,
  type OwnedPendingRef,
  type PendingResponseExtraction,
  type SafePendingProposalContext,
} from '@/lib/ai/pending-response';
import { createInMemoryPendingTimesheetChangeStore } from '@/lib/timesheet/write/pending-store';
import { createDefaultToolRegistry, createToolRouter } from '@/lib/tools';
import type { GenerateResponseFn } from '@/lib/ai/types';

const proposal: SafePendingProposalContext = {
  operation: 'create_entry',
  date: '2026-07-18',
  projectName: 'Commerce Suite (HERTZ)',
  taskName: 'Development',
  hours: 5,
  summaryText:
    'ต้องการบันทึกรายการนี้ใช่ไหมครับ\n• Hertz — Commerce Suite: Development 5 ชั่วโมง',
};

const ownedPending: OwnedPendingRef = {
  confirmationId: 'confirm_abc123',
  operation: 'create_entry',
  date: '2026-07-18',
  summaryPayload: {
    date: '2026-07-18',
    projectName: 'Commerce Suite (HERTZ)',
    taskName: 'Development',
    hours: 5,
    clientName: 'Hertz',
  },
  proposal,
};

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

function mockJsonGenerate(payload: unknown): GenerateResponseFn {
  return async () => ({
    text: JSON.stringify(payload),
    model: 'mock',
  });
}

describe('pending-response schema (G)', () => {
  it('accepts valid extraction', () => {
    expect(
      parsePendingResponseExtraction({
        intent: 'confirm',
        confidence: 0.9,
        hasNewMutation: false,
        correction: null,
        reasonCode: 'natural_agreement',
      }).intent
    ).toBe('confirm');
  });

  it('rejects additional properties', () => {
    expect(() =>
      parsePendingResponseExtraction({
        intent: 'confirm',
        confidence: 0.9,
        hasNewMutation: false,
        correction: null,
        reasonCode: 'ok',
        extra: true,
      })
    ).toThrow(/malformed/);
  });

  it('rejects identity / authorization fields', () => {
    for (const key of [
      'employeeId',
      'confirmationId',
      'executionVersion',
      'slackUserId',
      'toolName',
    ]) {
      expect(() =>
        parsePendingResponseExtraction({
          intent: 'confirm',
          confidence: 0.9,
          hasNewMutation: false,
          correction: null,
          reasonCode: 'ok',
          [key]: 'x',
        })
      ).toThrow(/forbidden/);
    }
  });

  it('maps empty / invalid JSON extractor outcomes', async () => {
    const empty = await extractPendingResponse(
      { userMessage: 'ok', proposal },
      { generate: async () => ({ text: '', model: 'm' }) }
    );
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.extractorOutcome).toBe('empty_response');

    const bad = await extractPendingResponse(
      { userMessage: 'ok', proposal },
      { generate: async () => ({ text: 'not-json', model: 'm' }) }
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.extractorOutcome).toBe('invalid_json');
  });

  it('maps transport timeout fail-closed', async () => {
    const { AiError } = await import('@/lib/ai/errors');
    const result = await extractPendingResponse(
      { userMessage: 'ok', proposal },
      {
        generate: async () => {
          throw new AiError('timed out', 'timeout');
        },
      }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.extractorOutcome).toBe('timeout');
  });
});

describe('deterministic enforcement (A,C,D,E,F)', () => {
  it('A: semantic confirm variations authorize confirm_timesheet_change only', () => {
    // Fixtures prove different natural replies map to confirm via mocked extraction —
    // not via a phrase allow-list in enforcement.
    const phrases = [
      'ได้เลยครับ',
      'โอเค บันทึกได้',
      'looks good, please save',
      'ไปได้เลย',
      'sure thing',
    ];
    for (const _phrase of phrases) {
      const result = enforcePendingResponse({
        userMessage: _phrase,
        extraction: extraction({
          intent: 'confirm',
          confidence: 0.95,
          reasonCode: 'natural_agreement',
        }),
        ownedPending,
      });
      expect(result.enforcementOutcome).toBe('confirm_authorized');
      expect(result.decision).toMatchObject({
        action: 'call_tool',
        toolName: 'confirm_timesheet_change',
        arguments: { confirmationId: 'confirm_abc123' },
      });
    }
  });

  it('B: previously unseen paraphrase confirms when extractor returns confirm', () => {
    // This wording is intentionally NOT in the extractor system prompt.
    const unseen = 'จัดไปพี่ เซฟให้หน่อยยย';
    const result = enforcePendingResponse({
      userMessage: unseen,
      extraction: extraction({
        intent: 'confirm',
        confidence: 0.88,
        reasonCode: 'colloquial_go_ahead',
      }),
      ownedPending,
    });
    expect(result.enforcementOutcome).toBe('confirm_authorized');
  });

  it('C: cancel wins; never confirms', () => {
    const result = enforcePendingResponse({
      userMessage: 'ไม่เอาแล้ว ยกเลิกเลย',
      extraction: extraction({
        intent: 'cancel',
        confidence: 0.9,
        reasonCode: 'polite_cancel',
      }),
      ownedPending,
    });
    expect(result.enforcementOutcome).toBe('cancel_authorized');
    expect(result.decision).toMatchObject({
      action: 'call_tool',
      toolName: 'cancel_timesheet_change',
    });
  });

  it('D: correction never confirms old proposal; prepares replacement', () => {
    const result = enforcePendingResponse({
      userMessage: 'เปลี่ยนเป็น 3 ชั่วโมง',
      extraction: extraction({
        intent: 'correction',
        confidence: 0.9,
        hasNewMutation: true,
        correction: { hours: 3 },
        reasonCode: 'hours_correction',
      }),
      ownedPending,
    });
    expect(result.enforcementOutcome).toBe('correction_prepare');
    expect(result.decision.action).toBe('call_tool');
    if (result.decision.action === 'call_tool') {
      expect(result.decision.toolName).toBe('prepare_create_timesheet_entry');
      expect(result.decision.arguments.hours).toBe(3);
    }
    expect(result.correctionPrepare?.cancelConfirmationId).toBe(
      'confirm_abc123'
    );
  });

  it('E: unrelated preserves pending (no confirm/cancel tool)', () => {
    const result = enforcePendingResponse({
      userMessage: 'เมื่อวานลงไปกี่ชั่วโมง',
      extraction: extraction({
        intent: 'unrelated',
        confidence: 0.9,
        reasonCode: 'off_topic_read',
      }),
      ownedPending,
    });
    expect(result.enforcementOutcome).toBe('unrelated_passthrough');
    expect(result.decision.action).toBe('none');
  });

  it('F: ambiguous / low confidence clarify with zero writes', () => {
    const ambiguous = enforcePendingResponse({
      userMessage: 'ก็ได้... หรือไม่ก็ยกเลิก',
      extraction: extraction({
        intent: 'ambiguous',
        confidence: 0.4,
        reasonCode: 'mixed',
      }),
      ownedPending,
    });
    expect(ambiguous.enforcementOutcome).toBe('clarify_ambiguous');
    expect(ambiguous.decision.action).toBe('clarify');

    const low = enforcePendingResponse({
      userMessage: 'อืม',
      extraction: extraction({
        intent: 'confirm',
        confidence: PENDING_CONFIRM_CONFIDENCE_THRESHOLD - 0.1,
        reasonCode: 'uncertain',
      }),
      ownedPending,
    });
    expect(low.enforcementOutcome).toBe('clarify_low_confidence');
    expect(isConfirmAuthorized(extraction({ intent: 'confirm', confidence: 0.5, hasNewMutation: true })).ok).toBe(
      false
    );
  });

  it('forbids confirm when hasNewMutation or correction set', () => {
    expect(
      isConfirmAuthorized(
        extraction({
          intent: 'confirm',
          hasNewMutation: true,
          correction: null,
        })
      ).ok
    ).toBe(false);
    expect(
      isConfirmAuthorized(
        extraction({
          intent: 'confirm',
          correction: { hours: 2 },
        })
      ).ok
    ).toBe(false);
  });

  it('G: extractor failure fail-closed', () => {
    const failure = enforceExtractorFailure('???', 'timeout');
    expect(failure.enforcementOutcome).toBe('clarify_extractor_failure');
    expect(failure.decision.action).toBe('clarify');
  });
});

describe('routePendingResponse ownership (H,K)', () => {
  it('H: no owned pending → not handled (cannot confirm foreign proposal)', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    const routed = await routePendingResponse({
      userMessage: 'ได้เลยครับ',
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore: store,
      getContext: async () =>
        ({
          conversationId: 'C1',
          slackUserId: 'U1',
          slackEmail: 'a@shopstack.asia',
          employeeId: 'S1',
          loadedAt: new Date(),
        }) as never,
      extractPending: async () => ({
        ok: true,
        extractorOutcome: 'extracted',
        extraction: extraction({ intent: 'confirm' }),
      }),
    });
    expect(routed.handled).toBe(false);
  });

  it('H: other employee cannot own pending', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await store.create({
      confirmationId: 'confirm_x',
      operation: 'create_entry',
      conversationId: 'C1',
      slackUserId: 'U1',
      employeeId: 'S_OTHER',
      originalSnapshot: { date: '2026-07-18', entries: [] },
      originalSnapshotHash: 'h1',
      proposedSnapshot: { date: '2026-07-18', entries: [] },
      proposedSnapshotHash: 'h2',
      summary: 'summary',
      summaryPayload: {
        date: '2026-07-18',
        hours: 5,
        projectName: 'P',
        taskName: 'T',
      },
      writeEntries: [],
    });

    const routed = await routePendingResponse({
      userMessage: 'confirm please',
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore: store,
      getContext: async () =>
        ({
          conversationId: 'C1',
          slackUserId: 'U1',
          slackEmail: 'a@shopstack.asia',
          employeeId: 'S1',
          loadedAt: new Date(),
        }) as never,
      extractPending: async () => ({
        ok: true,
        extractorOutcome: 'extracted',
        extraction: extraction({ intent: 'confirm' }),
      }),
    });
    expect(routed.handled).toBe(false);
  });

  it('K: with owned pending, semantic confirm routes to confirm tool', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await store.create({
      confirmationId: 'confirm_owned',
      operation: 'create_entry',
      conversationId: 'C1',
      slackUserId: 'U1',
      employeeId: 'S1',
      originalSnapshot: { date: '2026-07-18', entries: [] },
      originalSnapshotHash: 'h1',
      proposedSnapshot: { date: '2026-07-18', entries: [] },
      proposedSnapshotHash: 'h2',
      summary: 'summary',
      summaryPayload: {
        date: '2026-07-18',
        hours: 5,
        projectName: 'P',
        taskName: 'T',
      },
      writeEntries: [{ projectId: 'P1', taskId: 'T1', hours: 5 }],
    });

    const routed = await routePendingResponse({
      userMessage: 'จัดไปเลยครับ',
      conversationId: 'C1',
      slackUserId: 'U1',
      pendingStore: store,
      getContext: async () =>
        ({
          conversationId: 'C1',
          slackUserId: 'U1',
          slackEmail: 'a@shopstack.asia',
          employeeId: 'S1',
          loadedAt: new Date(),
        }) as never,
      extractPending: async () => ({
        ok: true,
        extractorOutcome: 'extracted',
        extraction: extraction({
          intent: 'confirm',
          confidence: 0.93,
          reasonCode: 'unseen_paraphrase',
        }),
      }),
    });
    expect(routed.handled).toBe(true);
    if (routed.handled) {
      expect(routed.decision).toMatchObject({
        action: 'call_tool',
        toolName: 'confirm_timesheet_change',
        arguments: { confirmationId: 'confirm_owned' },
      });
    }
  });
});

describe('L: production runConversation path', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('uses semantic extractor + tool registry; no phrase bypass', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await store.create({
      confirmationId: 'confirm_live',
      operation: 'create_entry',
      conversationId: 'conv-live',
      slackUserId: 'U-LIVE',
      employeeId: 'S0005',
      originalSnapshot: { date: '2026-07-18', entries: [] },
      originalSnapshotHash: 'h1',
      proposedSnapshot: {
        date: '2026-07-18',
        entries: [{ projectId: 'P1', taskId: 'T1', hours: 5 }],
      },
      proposedSnapshotHash: 'h2',
      summary: 'ต้องการบันทึก',
      summaryPayload: {
        date: '2026-07-18',
        hours: 5,
        projectName: 'Commerce',
        taskName: 'Dev',
        clientName: 'Hertz',
      },
      writeEntries: [{ projectId: 'P1', taskId: 'T1', hours: 5 }],
    });

    const confirmSpy = vi.fn(async () => ({
      success: true as const,
      tool: 'confirm_timesheet_change',
      result: {
        operation: 'create_entry',
        date: '2026-07-18',
        verified: { entries: [], totalHours: 5 },
        message: 'บันทึกเรียบร้อย',
      },
      durationMs: 1,
    }));

    const registry = createDefaultToolRegistry();
    // Replace confirm tool execute for isolation
    const original = registry.get('confirm_timesheet_change');
    expect(original).toBeDefined();
    registry.register({
      ...original!,
      async execute() {
        return confirmSpy();
      },
    });

    let extractCalls = 0;
    const result = await runConversation(
      {
        userMessage: 'โอเค ตามนั้นเลยนะครับ',
        conversationId: 'conv-live',
        requestId: 'req-1',
        metadata: { slackUserId: 'U-LIVE' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore: store,
        getContext: async () =>
          ({
            conversationId: 'conv-live',
            slackUserId: 'U-LIVE',
            slackEmail: 'test@shopstack.asia',
            employeeId: 'S0005',
            firstName: 'Ada',
            lastName: 'Lovelace',
            position: 'Engineer',
            loadedAt: new Date(),
          }) as never,
        extractPendingResponse: async () => {
          extractCalls += 1;
          return {
            ok: true,
            extractorOutcome: 'extracted',
            extraction: extraction({
              intent: 'confirm',
              confidence: 0.91,
              reasonCode: 'natural_thai_ack',
            }),
          };
        },
        // Should not be needed for pending confirm path
        decideWithIntent: async () => {
          throw new Error('decideWithIntent must not run when pending handled');
        },
        generate: async () => ({
          text: 'บันทึกเรียบร้อยแล้วครับ',
          model: 'mock',
        }),
      }
    );

    expect(extractCalls).toBe(1);
    expect(confirmSpy).toHaveBeenCalled();
    expect(result.usedFallback).toBe(false);
    expect(result.text).toMatch(/บันทึก|เรียบร้อย/);
  });

  it('K: natural acknowledgement with no pending does not call confirm', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    const confirmSpy = vi.fn();
    const registry = createDefaultToolRegistry();
    const original = registry.get('confirm_timesheet_change')!;
    registry.register({
      ...original,
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
        conversationId: 'conv-none',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore: store,
        getContext: async () =>
          ({
            conversationId: 'conv-none',
            slackUserId: 'U1',
            slackEmail: 'a@shopstack.asia',
            employeeId: 'S1',
            loadedAt: new Date(),
          }) as never,
        extractIntent: async () => ({
          domain: 'general',
          intent: 'general_conversation',
          confidence: 'high',
          missingFields: [],
          ambiguities: [],
          refersToPrevious: false,
        }),
        generate: async () => ({
          text: 'มีอะไรให้ช่วยเกี่ยวกับ Timesheet ไหมครับ',
          model: 'mock',
        }),
      }
    );

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('C: cancel path never invokes writer', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    await store.create({
      confirmationId: 'confirm_cancel',
      operation: 'create_entry',
      conversationId: 'conv-c',
      slackUserId: 'U1',
      employeeId: 'S1',
      originalSnapshot: { date: '2026-07-18', entries: [] },
      originalSnapshotHash: 'h1',
      proposedSnapshot: { date: '2026-07-18', entries: [] },
      proposedSnapshotHash: 'h2',
      summary: 's',
      summaryPayload: { date: '2026-07-18', hours: 1, projectName: 'P', taskName: 'T' },
      writeEntries: [],
    });

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
        conversationId: 'conv-c',
        metadata: { slackUserId: 'U1' },
      },
      {
        toolRegistry: registry,
        toolRouter: createToolRouter(registry),
        pendingStore: store,
        getContext: async () =>
          ({
            conversationId: 'conv-c',
            slackUserId: 'U1',
            slackEmail: 'a@shopstack.asia',
            employeeId: 'S1',
            loadedAt: new Date(),
          }) as never,
        extractPendingResponse: async () => ({
          ok: true,
          extractorOutcome: 'extracted',
          extraction: extraction({ intent: 'cancel', confidence: 0.95 }),
        }),
        decideWithIntent: async () => {
          throw new Error('should not reach normal intent');
        },
        generate: async () => ({ text: 'ยกเลิกแล้วครับ', model: 'mock' }),
      }
    );

    expect(cancelSpy).toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('extractor with mocked OpenAI transport (A)', () => {
  it('parses mocked model JSON into confirm without phrase matching', async () => {
    const result = await extractPendingResponse(
      {
        userMessage: 'ได้เลยพี่ เซฟให้หน่อย',
        proposal,
      },
      {
        generate: mockJsonGenerate({
          intent: 'confirm',
          confidence: 0.94,
          hasNewMutation: false,
          correction: null,
          reasonCode: 'colloquial_save',
        }),
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extraction.intent).toBe('confirm');
      expect(result.extraction.confidence).toBeGreaterThanOrEqual(
        PENDING_CONFIRM_CONFIDENCE_THRESHOLD
      );
    }
  });
});

/**
 * Pending-aware routing with multi-pending selection persistence.
 * Selection is navigation state — not write authorization.
 */

import { logPendingResponseAudit } from '@/lib/ai/pending-response/audit';
import {
  enforceExtractorFailure,
  enforcePendingResponse,
  type EnforcePendingResponseResult,
  type OwnedPendingRef,
} from '@/lib/ai/pending-response/enforce';
import {
  extractPendingResponse,
  type ExtractPendingResponseFn,
} from '@/lib/ai/pending-response/extract';
import {
  loadOwnedPendingChange,
  type LoadOwnedPendingInput,
} from '@/lib/ai/pending-response/load-owned';
import {
  buildChoiceSnapshot,
  formatOwnedPendingChoices,
  formatSelectedPendingSummary,
  resolvePendingSelectionDecision,
} from '@/lib/ai/pending-response/select-pending';
import {
  getDefaultSelectedPendingStore,
  type SelectedPendingStore,
} from '@/lib/ai/pending-response/selection-store';
import { earliestPendingExpiryIso } from '@/lib/ai/pending-response/selection-types';
import type { BusinessToolDecision } from '@/lib/ai/decision-engine';
import type { GenerateResponseFn } from '@/lib/ai/types';

export type RoutePendingResponseInput = {
  userMessage: string;
  conversationId?: string;
  slackUserId?: string;
  requestId?: string;
  eventId?: string;
  generate?: GenerateResponseFn;
  extractPending?: ExtractPendingResponseFn;
  loadOwned?: (input: LoadOwnedPendingInput) => ReturnType<
    typeof loadOwnedPendingChange
  >;
  pendingStore?: LoadOwnedPendingInput['pendingStore'];
  getContext?: LoadOwnedPendingInput['getContext'];
  nowMs?: number;
  selectionStore?: SelectedPendingStore;
};

export type RoutePendingResponseResult =
  | {
      handled: false;
      reason: 'no_pending' | 'missing_ids';
    }
  | {
      handled: true;
      decision: BusinessToolDecision;
      enforcement: EnforcePendingResponseResult;
      ownedPending?: OwnedPendingRef;
      extractorOutcome?: string;
      /** Clear selection navigation after successful confirm/cancel/correction. */
      clearSelectionOnSuccess?: boolean;
      /** Clear selection immediately (expired / ownership / choose-another). */
      clearSelectionNow?: boolean;
    };

function looksThai(text: string): boolean {
  return /[\u0E00-\u0E7F]/.test(text);
}

function selectionExpiredResult(userMessage: string): RoutePendingResponseResult {
  const message = looksThai(userMessage)
    ? 'รายการที่เลือกรอการยืนยันหมดอายุแล้วครับ กรุณาเสนอรายการใหม่'
    : 'The selected pending proposal has expired. Please submit a new proposal.';
  return {
    handled: true,
    decision: {
      action: 'clarify',
      message,
      reason: 'selected_pending_expired',
    },
    enforcement: {
      decision: {
        action: 'clarify',
        message,
        reason: 'selected_pending_expired',
      },
      enforcementOutcome: 'selection_expired',
      confidenceBand: 'none',
    },
    clearSelectionNow: true,
  };
}

async function showMultipleChoices(input: {
  userMessage: string;
  candidates: OwnedPendingRef[];
  conversationId: string;
  slackUserId: string;
  employeeId: string;
  selectionStore: SelectedPendingStore;
  nowMs: number;
  requestId?: string;
  eventId?: string;
}): Promise<RoutePendingResponseResult> {
  const { message, ordered } = formatOwnedPendingChoices(
    input.candidates,
    input.userMessage
  );
  const snapshot = buildChoiceSnapshot({
    conversationId: input.conversationId,
    slackUserId: input.slackUserId,
    employeeId: input.employeeId,
    ordered,
    nowMs: input.nowMs,
    expiresAt: earliestPendingExpiryIso(ordered, input.nowMs),
  });
  const saved = await input.selectionStore.setChoices(snapshot, input.nowMs);
  if (saved.outcome === 'unavailable') {
    return {
      handled: true,
      decision: {
        action: 'clarify',
        message: looksThai(input.userMessage)
          ? 'ระบบยืนยัน Timesheet ใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งครับ'
          : 'Timesheet confirmation is temporarily unavailable. Please try again.',
        reason: 'selection_store_unavailable',
      },
      enforcement: {
        decision: {
          action: 'clarify',
          message: looksThai(input.userMessage)
            ? 'ระบบยืนยัน Timesheet ใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งครับ'
            : 'Timesheet confirmation is temporarily unavailable. Please try again.',
          reason: 'selection_store_unavailable',
        },
        enforcementOutcome: 'clarify_extractor_failure',
        confidenceBand: 'none',
      },
    };
  }

  logPendingResponseAudit({
    requestId: input.requestId,
    eventId: input.eventId,
    conversationId: input.conversationId,
    pendingResponseOutcome: 'semantic_handled',
    enforcementOutcome: 'clarify_multiple_owned',
  });

  return {
    handled: true,
    decision: {
      action: 'clarify',
      message,
      reason: 'multiple_owned_pending',
    },
    enforcement: {
      decision: {
        action: 'clarify',
        message,
        reason: 'multiple_owned_pending',
      },
      enforcementOutcome: 'clarify_multiple_owned',
      confidenceBand: 'none',
    },
  };
}

function selectionPersistedResult(
  pending: OwnedPendingRef,
  userMessage: string
): RoutePendingResponseResult {
  const message = formatSelectedPendingSummary(pending, userMessage);
  return {
    handled: true,
    decision: {
      action: 'clarify',
      message,
      reason: 'pending_selection_persisted',
    },
    enforcement: {
      decision: {
        action: 'clarify',
        message,
        reason: 'pending_selection_persisted',
      },
      enforcementOutcome: 'selection_persisted',
      confidenceBand: 'none',
    },
    ownedPending: pending,
  };
}

async function persistSelectedTarget(input: {
  selectionStore: SelectedPendingStore;
  conversationId: string;
  slackUserId: string;
  employeeId: string;
  pending: OwnedPendingRef;
  nowMs: number;
  selectionVersion?: number;
}): Promise<'ok' | 'unavailable'> {
  const expiresAt = earliestPendingExpiryIso([input.pending], input.nowMs);
  const result = await input.selectionStore.setSelected(
    {
      schemaVersion: 1,
      conversationId: input.conversationId,
      slackUserId: input.slackUserId,
      employeeId: input.employeeId,
      confirmationId: input.pending.confirmationId,
      selectedAt: new Date(input.nowMs).toISOString(),
      expiresAt,
      selectionVersion: input.selectionVersion ?? 1,
    },
    input.nowMs
  );
  if (result.outcome === 'ok') {
    await input.selectionStore.clearChoices(
      input.conversationId,
      input.slackUserId
    );
  }
  return result.outcome === 'ok' ? 'ok' : 'unavailable';
}

async function runSemanticAgainstOwned(
  input: RoutePendingResponseInput,
  ownedPending: OwnedPendingRef,
  conversationId: string,
  userMessage: string,
  options?: { responseTextOverride?: string; clearSelectionOnSuccess?: boolean }
): Promise<RoutePendingResponseResult> {
  const extract = input.extractPending ?? extractPendingResponse;
  const extracted = await extract({
    userMessage: options?.responseTextOverride ?? userMessage,
    proposal: ownedPending.proposal,
    requestId: input.requestId,
    eventId: input.eventId,
  });

  if (!extracted.ok) {
    const failure = enforceExtractorFailure(
      userMessage,
      extracted.extractorOutcome
    );
    logPendingResponseAudit({
      requestId: input.requestId,
      eventId: input.eventId,
      conversationId,
      pendingResponseOutcome: 'semantic_handled',
      extractorOutcome: extracted.extractorOutcome,
      enforcementOutcome: failure.enforcementOutcome,
    });
    return {
      handled: true,
      decision: failure.decision,
      enforcement: failure,
      ownedPending,
      extractorOutcome: extracted.extractorOutcome,
      // Preserve selection on extractor failure
    };
  }

  const enforcement = enforcePendingResponse({
    userMessage,
    extraction: extracted.extraction,
    ownedPending,
  });

  logPendingResponseAudit({
    requestId: input.requestId,
    eventId: input.eventId,
    conversationId,
    pendingResponseOutcome: 'semantic_handled',
    extractorOutcome: 'extracted',
    enforcementOutcome: enforcement.enforcementOutcome,
    confidence: extracted.extraction.confidence,
    selectedTool:
      enforcement.decision.action === 'call_tool'
        ? enforcement.decision.toolName
        : undefined,
  });

  const clearOnSuccess =
    options?.clearSelectionOnSuccess !== false &&
    (enforcement.enforcementOutcome === 'confirm_authorized' ||
      enforcement.enforcementOutcome === 'cancel_authorized' ||
      enforcement.enforcementOutcome === 'correction_prepare');

  return {
    handled: true,
    decision: enforcement.decision,
    enforcement,
    ownedPending,
    extractorOutcome: 'extracted',
    clearSelectionOnSuccess: clearOnSuccess || undefined,
  };
}

/**
 * After a unique target is known from multi-pending selection, either persist
 * selection-only or upgrade to action via semantic classification.
 */
async function afterUniqueSelection(input: {
  routeInput: RoutePendingResponseInput;
  pending: OwnedPendingRef;
  conversationId: string;
  slackUserId: string;
  employeeId: string;
  userMessage: string;
  selectionStore: SelectedPendingStore;
  nowMs: number;
  /** When true, always treat as selection-only (bare ordinal). */
  forceSelectionOnly?: boolean;
}): Promise<RoutePendingResponseResult> {
  const saved = await persistSelectedTarget({
    selectionStore: input.selectionStore,
    conversationId: input.conversationId,
    slackUserId: input.slackUserId,
    employeeId: input.employeeId,
    pending: input.pending,
    nowMs: input.nowMs,
  });
  if (saved === 'unavailable') {
    return {
      handled: true,
      decision: {
        action: 'clarify',
        message: looksThai(input.userMessage)
          ? 'ระบบยืนยัน Timesheet ใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งครับ'
          : 'Timesheet confirmation is temporarily unavailable. Please try again.',
        reason: 'selection_store_unavailable',
      },
      enforcement: {
        decision: {
          action: 'clarify',
          message: looksThai(input.userMessage)
            ? 'ระบบยืนยัน Timesheet ใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งครับ'
            : 'Timesheet confirmation is temporarily unavailable. Please try again.',
          reason: 'selection_store_unavailable',
        },
        enforcementOutcome: 'clarify_extractor_failure',
        confidenceBand: 'none',
      },
    };
  }

  if (input.forceSelectionOnly) {
    logPendingResponseAudit({
      requestId: input.routeInput.requestId,
      eventId: input.routeInput.eventId,
      conversationId: input.conversationId,
      pendingResponseOutcome: 'semantic_handled',
      enforcementOutcome: 'selection_persisted',
    });
    return selectionPersistedResult(input.pending, input.userMessage);
  }

  // Try semantic on the same message for selection-plus-action.
  const semantic = await runSemanticAgainstOwned(
    input.routeInput,
    input.pending,
    input.conversationId,
    input.userMessage,
    { clearSelectionOnSuccess: true }
  );

  if (
    semantic.handled &&
    (semantic.enforcement.enforcementOutcome === 'confirm_authorized' ||
      semantic.enforcement.enforcementOutcome === 'cancel_authorized' ||
      semantic.enforcement.enforcementOutcome === 'correction_prepare')
  ) {
    return semantic;
  }

  // Ambiguous / unrelated / low confidence / correction clarify → selection-only ask
  if (
    semantic.handled &&
    (semantic.enforcement.enforcementOutcome === 'unrelated_passthrough' ||
      semantic.enforcement.enforcementOutcome === 'clarify_ambiguous' ||
      semantic.enforcement.enforcementOutcome === 'clarify_low_confidence' ||
      semantic.enforcement.enforcementOutcome === 'clarify_conflict' ||
      semantic.enforcement.enforcementOutcome === 'clarify_extractor_failure' ||
      semantic.enforcement.enforcementOutcome === 'correction_clarify')
  ) {
    // If unrelated while selecting, still confirm the selection was stored
    // (selection survives unrelated on later turns via selected target).
    // For pure selection words like "Hertz", prefer selection_persisted UX.
    logPendingResponseAudit({
      requestId: input.routeInput.requestId,
      eventId: input.routeInput.eventId,
      conversationId: input.conversationId,
      pendingResponseOutcome: 'semantic_handled',
      enforcementOutcome: 'selection_persisted',
    });
    return selectionPersistedResult(input.pending, input.userMessage);
  }

  return semantic;
}

export async function routePendingResponse(
  input: RoutePendingResponseInput
): Promise<RoutePendingResponseResult> {
  const conversationId = input.conversationId?.trim() || '';
  const slackUserId = input.slackUserId?.trim() || '';
  const userMessage = input.userMessage?.trim() || '';
  const nowMs = input.nowMs ?? Date.now();
  const selectionStore =
    input.selectionStore ?? getDefaultSelectedPendingStore();

  if (!conversationId || !slackUserId || !userMessage) {
    logPendingResponseAudit({
      requestId: input.requestId,
      eventId: input.eventId,
      conversationId: conversationId || undefined,
      pendingResponseOutcome: 'skipped',
    });
    return { handled: false, reason: 'missing_ids' };
  }

  const load = input.loadOwned ?? loadOwnedPendingChange;
  const ownedResult = await load({
    conversationId,
    slackUserId,
    requestId: input.requestId,
    pendingStore: input.pendingStore,
    getContext: input.getContext,
    nowMs,
  });

  switch (ownedResult.status) {
    case 'store_unavailable': {
      logPendingResponseAudit({
        requestId: input.requestId,
        eventId: input.eventId,
        conversationId,
        pendingResponseOutcome: 'store_unavailable',
        enforcementOutcome: 'clarify_extractor_failure',
      });
      return { handled: false, reason: 'no_pending' };
    }
    case 'context_unavailable': {
      await selectionStore.clearAll(conversationId, slackUserId);
      logPendingResponseAudit({
        requestId: input.requestId,
        eventId: input.eventId,
        conversationId,
        pendingResponseOutcome: 'ownership_denied',
        enforcementOutcome: 'ownership_denied',
      });
      return {
        handled: true,
        decision: {
          action: 'clarify',
          message:
            'ยังไม่สามารถยืนยันตัวตนเพื่อจัดการรายการที่รออยู่ได้ครับ กรุณาลองใหม่อีกครั้ง',
          reason: 'pending_context_unavailable',
        },
        enforcement: {
          decision: {
            action: 'clarify',
            message:
              'ยังไม่สามารถยืนยันตัวตนเพื่อจัดการรายการที่รออยู่ได้ครับ กรุณาลองใหม่อีกครั้ง',
            reason: 'pending_context_unavailable',
          },
          enforcementOutcome: 'ownership_denied',
          confidenceBand: 'none',
        },
        clearSelectionNow: true,
      };
    }
    case 'none': {
      // employeeId is present only when Conversation Context resolved successfully.
      if (typeof ownedResult.employeeId === 'string' && ownedResult.employeeId) {
        const employeeId = ownedResult.employeeId;
        const prior = await selectionStore.getSelected(
          conversationId,
          slackUserId,
          employeeId,
          nowMs
        );
        if (prior.outcome === 'found' || prior.outcome === 'expired') {
          await selectionStore.clearAll(conversationId, slackUserId);
          logPendingResponseAudit({
            requestId: input.requestId,
            eventId: input.eventId,
            conversationId,
            pendingResponseOutcome: 'semantic_handled',
            enforcementOutcome: 'selection_expired',
          });
          return selectionExpiredResult(userMessage);
        }
        if (prior.outcome === 'unavailable') {
          return {
            handled: true,
            decision: {
              action: 'clarify',
              message: looksThai(userMessage)
                ? 'ระบบยืนยัน Timesheet ใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งครับ'
                : 'Timesheet confirmation is temporarily unavailable. Please try again.',
              reason: 'selection_store_unavailable',
            },
            enforcement: {
              decision: {
                action: 'clarify',
                message: looksThai(userMessage)
                  ? 'ระบบยืนยัน Timesheet ใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งครับ'
                  : 'Timesheet confirmation is temporarily unavailable. Please try again.',
                reason: 'selection_store_unavailable',
              },
              enforcementOutcome: 'clarify_extractor_failure',
              confidenceBand: 'none',
            },
          };
        }
        // Trusted identity, no confirmable pending, no selected target → clear leftovers
        await selectionStore.clearAll(conversationId, slackUserId);
      }
      // No trusted employeeId: do not validate selected ownership; no pending action.
      logPendingResponseAudit({
        requestId: input.requestId,
        eventId: input.eventId,
        conversationId,
        pendingResponseOutcome: 'no_pending',
        enforcementOutcome: 'no_owned_pending',
      });
      return { handled: false, reason: 'no_pending' };
    }
    case 'owned':
    case 'multiple_owned':
      break;
    default: {
      const _exhaustive: never = ownedResult;
      void _exhaustive;
      return { handled: false, reason: 'no_pending' };
    }
  }

  const employeeId = ownedResult.employeeId;
  const candidates: OwnedPendingRef[] =
    ownedResult.status === 'owned'
      ? [ownedResult.pending]
      : ownedResult.pending;

  // --- Validate existing selected target ---
  const selectedGet = await selectionStore.getSelected(
    conversationId,
    slackUserId,
    employeeId,
    nowMs
  );
  if (selectedGet.outcome === 'unavailable') {
    return {
      handled: true,
      decision: {
        action: 'clarify',
        message: looksThai(userMessage)
          ? 'ระบบยืนยัน Timesheet ใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งครับ'
          : 'Timesheet confirmation is temporarily unavailable. Please try again.',
        reason: 'selection_store_unavailable',
      },
      enforcement: {
        decision: {
          action: 'clarify',
          message: looksThai(userMessage)
            ? 'ระบบยืนยัน Timesheet ใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งครับ'
            : 'Timesheet confirmation is temporarily unavailable. Please try again.',
          reason: 'selection_store_unavailable',
        },
        enforcementOutcome: 'clarify_extractor_failure',
        confidenceBand: 'none',
      },
    };
  }

  if (selectedGet.outcome === 'found') {
    const live = candidates.find(
      (c) => c.confirmationId === selectedGet.target.confirmationId
    );
    if (!live) {
      await selectionStore.clearAll(conversationId, slackUserId);
      // Fall through to multi/single selection
    } else {
      // Valid selection — semantic against this proposal only
      const semantic = await runSemanticAgainstOwned(
        input,
        live,
        conversationId,
        userMessage,
        { clearSelectionOnSuccess: true }
      );

      // Unrelated: answer normally but preserve selection
      if (
        semantic.handled &&
        semantic.enforcement.enforcementOutcome === 'unrelated_passthrough'
      ) {
        return semantic;
      }

      // Ambiguous / low confidence: clarify, keep selection
      return semantic;
    }
  }

  // --- Exactly one owned pending ---
  if (ownedResult.status === 'owned') {
    return runSemanticAgainstOwned(
      input,
      ownedResult.pending,
      conversationId,
      userMessage
    );
  }

  // --- Multiple owned: ordinal / business selection ---
  const choicesGet = await selectionStore.getChoices(
    conversationId,
    slackUserId,
    employeeId,
    nowMs
  );
  if (choicesGet.outcome === 'unavailable') {
    return {
      handled: true,
      decision: {
        action: 'clarify',
        message: looksThai(userMessage)
          ? 'ระบบยืนยัน Timesheet ใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งครับ'
          : 'Timesheet confirmation is temporarily unavailable. Please try again.',
        reason: 'selection_store_unavailable',
      },
      enforcement: {
        decision: {
          action: 'clarify',
          message: looksThai(userMessage)
            ? 'ระบบยืนยัน Timesheet ใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งครับ'
            : 'Timesheet confirmation is temporarily unavailable. Please try again.',
          reason: 'selection_store_unavailable',
        },
        enforcementOutcome: 'clarify_extractor_failure',
        confidenceBand: 'none',
      },
    };
  }

  const snapshot =
    choicesGet.outcome === 'found' ? choicesGet.snapshot : null;
  const decision = resolvePendingSelectionDecision({
    userMessage,
    candidates,
    snapshot,
  });

  if (decision.status === 'invalid_ordinal') {
    return showMultipleChoices({
      userMessage,
      candidates,
      conversationId,
      slackUserId,
      employeeId,
      selectionStore,
      nowMs,
      requestId: input.requestId,
      eventId: input.eventId,
    });
  }

  if (decision.status === 'selected_only') {
    const forceOnly =
      // bare ordinal protocol is always selection-only
      /^\d{1,2}$/.test(userMessage.trim()) ||
      /^(?:ข้อ|รายการ|number|no\.?|#)\s*\d{1,2}$/i.test(userMessage.trim()) ||
      /^เลือก\s*(?:ข้อ|รายการ)?\s*\d{1,2}$/i.test(userMessage.trim());

    return afterUniqueSelection({
      routeInput: input,
      pending: decision.pending,
      conversationId,
      slackUserId,
      employeeId,
      userMessage,
      selectionStore,
      nowMs,
      forceSelectionOnly: forceOnly,
    });
  }

  if (decision.status === 'selected_with_action') {
    await persistSelectedTarget({
      selectionStore,
      conversationId,
      slackUserId,
      employeeId,
      pending: decision.pending,
      nowMs,
    });
    return runSemanticAgainstOwned(
      input,
      decision.pending,
      conversationId,
      decision.responseText,
      { clearSelectionOnSuccess: true }
    );
  }

  // none / ambiguous / stale → re-list
  return showMultipleChoices({
    userMessage,
    candidates,
    conversationId,
    slackUserId,
    employeeId,
    selectionStore,
    nowMs,
    requestId: input.requestId,
    eventId: input.eventId,
  });
}

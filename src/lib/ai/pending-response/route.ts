/**
 * Pending-aware routing: semantic extraction → deterministic enforcement.
 * Runs before normal AI-first Timesheet intent extraction when an owned pending exists.
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
    };

/**
 * If an owned pending confirmation exists, classify the user reply semantically
 * and map to confirm / cancel / correction / clarify / unrelated passthrough.
 * Otherwise return handled:false so the caller continues the normal AI-first path.
 */
export async function routePendingResponse(
  input: RoutePendingResponseInput
): Promise<RoutePendingResponseResult> {
  const conversationId = input.conversationId?.trim() || '';
  const slackUserId = input.slackUserId?.trim() || '';
  const userMessage = input.userMessage?.trim() || '';

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
  });

  if (ownedResult.status === 'store_unavailable') {
    logPendingResponseAudit({
      requestId: input.requestId,
      eventId: input.eventId,
      conversationId,
      pendingResponseOutcome: 'store_unavailable',
      enforcementOutcome: 'clarify_extractor_failure',
    });
    // Cannot prove ownership — do not authorize pending writes.
    // Continue the normal AI-first path with confirm/cancel suppressed by caller.
    return { handled: false, reason: 'no_pending' };
  }

  if (ownedResult.status === 'context_unavailable') {
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
    };
  }

  if (ownedResult.status === 'none') {
    logPendingResponseAudit({
      requestId: input.requestId,
      eventId: input.eventId,
      conversationId,
      pendingResponseOutcome: 'no_pending',
      enforcementOutcome: 'no_owned_pending',
    });
    return { handled: false, reason: 'no_pending' };
  }

  const extract = input.extractPending ?? extractPendingResponse;
  const extracted = await extract({
    userMessage,
    proposal: ownedResult.pending.proposal,
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
      ownedPending: ownedResult.pending,
      extractorOutcome: extracted.extractorOutcome,
    };
  }

  const enforcement = enforcePendingResponse({
    userMessage,
    extraction: extracted.extraction,
    ownedPending: ownedResult.pending,
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

  return {
    handled: true,
    decision: enforcement.decision,
    enforcement,
    ownedPending: ownedResult.pending,
    extractorOutcome: 'extracted',
  };
}

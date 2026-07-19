/**
 * AI-first decision orchestrator with deterministic regex fallback.
 */

import {
  decideBusinessTool,
  type BusinessToolDecision,
  type DecideBusinessToolOptions,
} from '@/lib/ai/decision-engine';
import { isAiIntentExtractionEnabled } from '@/lib/ai/intent/config';
import {
  createRedisIntentDraftStore,
  draftSummary,
  type IntentDraftStore,
} from '@/lib/ai/intent/draft-store';
import {
  DRAFT_CANCELLED_MESSAGE,
  DRAFT_FOLLOWUP_UNAVAILABLE_CLARIFY,
  enforceStructuredIntentDetailed,
  looksLikeBusinessTimesheetText,
  type EnforceIntentOptions,
} from '@/lib/ai/intent/enforce';
import {
  extractStructuredIntent,
  type ExtractIntentFn,
} from '@/lib/ai/intent/extract';
import {
  isExplicitDraftCancelPhrase,
} from '@/lib/ai/intent/follow-up';
import type { IntentDraft, StructuredIntent } from '@/lib/ai/intent/types';
import {
  isBareCancelPhrase,
  isBareConfirmPhrase,
  resolveConfirmOrCancel,
} from '@/lib/ai/write-decision';

export type DecideWithIntentOptions = DecideBusinessToolOptions & {
  conversationId?: string;
  slackUserId?: string;
  requestId?: string;
  eventId?: string;
  extractIntent?: ExtractIntentFn;
  draftStore?: IntentDraftStore;
  intentExtractionEnabled?: boolean;
  /** When true, skip AI and use regex Decision Engine only. */
  forceRegexFallback?: boolean;
  resolveProjectFn?: EnforceIntentOptions['resolveProjectFn'];
  resolveTaskFn?: EnforceIntentOptions['resolveTaskFn'];
};

export type DecideWithIntentResult = {
  decision: BusinessToolDecision;
  fallbackUsed: boolean;
  extractedIntent?: StructuredIntent;
  typedErrorCode?: string;
  draftStoreAvailable?: boolean;
  draftOutcome?: string;
};

function logIntent(payload: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      scope: 'ai-intent',
      level: 'info',
      ts: new Date().toISOString(),
      ...payload,
    })
  );
}

/**
 * Primary entry: AI structured extraction → deterministic enforce → regex fallback.
 */
export async function decideWithIntentExtraction(
  userMessage: string,
  options: DecideWithIntentOptions = {}
): Promise<DecideWithIntentResult> {
  const text = userMessage?.trim() || '';
  const now = options.now ?? new Date();
  const pending = options.pendingChanges ?? [];
  const enabled =
    options.intentExtractionEnabled ?? isAiIntentExtractionEnabled();

  const draftStore =
    options.draftStore ??
    (options.conversationId && options.slackUserId
      ? createRedisIntentDraftStore()
      : undefined);

  // --- Deterministic confirm / cancel precedence ---
  if (isBareConfirmPhrase(text) || isBareCancelPhrase(text)) {
    const cc = resolveConfirmOrCancel(text, pending);
    if (cc && (cc.action === 'call_tool' || pending.length > 0)) {
      if (draftStore && options.conversationId && options.slackUserId) {
        await draftStore.clear(options.conversationId, options.slackUserId);
      }
      logIntent({
        message: 'deterministic_confirm_cancel',
        requestId: options.requestId,
        eventId: options.eventId,
        conversationId: options.conversationId,
        selectedTool:
          cc.action === 'call_tool' ? cc.toolName : undefined,
        clarificationReason: cc.action === 'clarify' ? cc.reason : undefined,
        fallbackUsed: false,
      });
      return { decision: cc, fallbackUsed: false, draftStoreAvailable: true };
    }

    // Bare cancel with no pending confirmation → clear Intent Draft if any
    if (isBareCancelPhrase(text) && pending.length === 0) {
      const draftLoad = await safeLoadDraft(draftStore, options);
      if (draftLoad.draft) {
        await draftStore?.clear(
          options.conversationId!,
          options.slackUserId!
        );
        return {
          decision: {
            action: 'clarify',
            message: DRAFT_CANCELLED_MESSAGE,
            reason: 'intent_draft_cancelled',
          },
          fallbackUsed: false,
          draftOutcome: 'draft_cleared',
          draftStoreAvailable: draftLoad.available,
        };
      }
      if (cc) {
        return {
          decision: cc,
          fallbackUsed: false,
          draftStoreAvailable: draftLoad.available,
        };
      }
    }

    if (cc) {
      return { decision: cc, fallbackUsed: false };
    }
  }

  if (isExplicitDraftCancelPhrase(text)) {
    const draftLoad = await safeLoadDraft(draftStore, options);
    if (draftLoad.available === false) {
      return {
        decision: {
          action: 'clarify',
          message: DRAFT_FOLLOWUP_UNAVAILABLE_CLARIFY,
          reason: 'draft_store_unavailable',
        },
        fallbackUsed: false,
        typedErrorCode: 'draft_store_unavailable',
        draftStoreAvailable: false,
      };
    }
    if (draftStore && options.conversationId && options.slackUserId) {
      await draftStore.clear(options.conversationId, options.slackUserId);
    }
    return {
      decision: {
        action: 'clarify',
        message: DRAFT_CANCELLED_MESSAGE,
        reason: 'intent_draft_cancelled',
      },
      fallbackUsed: false,
      draftOutcome: 'draft_cleared',
      draftStoreAvailable: true,
    };
  }

  if (!enabled || options.forceRegexFallback) {
    const decision = decideBusinessTool(text, { now, pendingChanges: pending });
    return { decision, fallbackUsed: !enabled };
  }

  const draftLoad = await safeLoadDraft(draftStore, options);
  const draft: IntentDraft | undefined = draftLoad.draft;
  const draftLoadFailed = draftLoad.available === false;

  const extract = options.extractIntent ?? extractStructuredIntent;

  try {
    const extracted = await extract({
      userMessage: text,
      draftSummary: draft ? draftSummary(draft) : undefined,
      requestId: options.requestId,
      eventId: options.eventId,
    });

    const enforced = await enforceStructuredIntentDetailed(extracted, {
      now,
      pendingChanges: pending,
      draft,
      draftLoadFailed,
      draftStore,
      conversationId: options.conversationId,
      slackUserId: options.slackUserId,
      userMessage: text,
      resolveProjectFn: options.resolveProjectFn,
      resolveTaskFn: options.resolveTaskFn,
    });

    logIntent({
      message: 'intent_enforced',
      requestId: options.requestId,
      eventId: options.eventId,
      conversationId: options.conversationId,
      extractionOutcome: 'ok',
      extractedIntent: extracted.intent,
      confidence: extracted.confidence,
      missingFields: extracted.missingFields,
      selectedTool:
        enforced.decision.action === 'call_tool'
          ? enforced.decision.toolName
          : undefined,
      clarificationReason:
        enforced.decision.action === 'clarify'
          ? enforced.decision.reason
          : undefined,
      fallbackUsed: false,
      toolResultStatus: enforced.decision.action,
      draftStoreAvailable: enforced.draftStoreAvailable ?? draftLoad.available,
      draftOutcome: enforced.draftOutcome,
      typedErrorCode:
        enforced.decision.reason === 'draft_store_unavailable'
          ? 'draft_store_unavailable'
          : undefined,
    });

    return {
      decision: enforced.decision,
      fallbackUsed: false,
      extractedIntent: extracted,
      draftStoreAvailable: enforced.draftStoreAvailable ?? draftLoad.available,
      draftOutcome: enforced.draftOutcome,
      typedErrorCode:
        enforced.decision.reason === 'draft_store_unavailable'
          ? 'draft_store_unavailable'
          : undefined,
    };
  } catch (error) {
    const typedErrorCode =
      error instanceof Error && error.message.startsWith('malformed_intent')
        ? 'malformed_intent'
        : 'extraction_failed';

    logIntent({
      message: 'intent_extraction_fallback',
      requestId: options.requestId,
      eventId: options.eventId,
      conversationId: options.conversationId,
      extractionOutcome: 'failed',
      typedErrorCode,
      fallbackUsed: true,
      draftStoreAvailable: draftLoad.available,
      error: error instanceof Error ? error.message : 'unknown',
    });

    const decision = decideBusinessTool(text, { now, pendingChanges: pending });

    if (
      decision.action === 'none' &&
      looksLikeBusinessTimesheetText(text)
    ) {
      return {
        decision: {
          action: 'clarify',
          message:
            'ต้องการทำรายการ Timesheet แบบไหนครับ โปรดระบุวันที่ Project งาน และจำนวนชั่วโมง',
          reason: 'fallback_business_clarify',
        },
        fallbackUsed: true,
        typedErrorCode,
        draftStoreAvailable: draftLoad.available,
      };
    }

    return {
      decision,
      fallbackUsed: true,
      typedErrorCode,
      draftStoreAvailable: draftLoad.available,
    };
  }
}

async function safeLoadDraft(
  draftStore: IntentDraftStore | undefined,
  options: DecideWithIntentOptions
): Promise<{
  draft?: IntentDraft;
  available: boolean;
  outcome?: string;
}> {
  if (!draftStore || !options.conversationId || !options.slackUserId) {
    return { available: true, outcome: 'draft_not_found' };
  }
  try {
    const result = await draftStore.get(
      options.conversationId,
      options.slackUserId
    );
    if (result.outcome === 'draft_store_unavailable') {
      return { available: false, outcome: 'draft_store_unavailable' };
    }
    if (result.outcome === 'draft_found') {
      return {
        draft: result.draft,
        available: true,
        outcome: 'draft_found',
      };
    }
    return { available: true, outcome: result.outcome };
  } catch {
    return { available: false, outcome: 'draft_store_unavailable' };
  }
}

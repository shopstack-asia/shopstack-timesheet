/**
 * AI-first decision orchestrator — always-on structured extraction.
 * Regex is used only for bare confirm/cancel and related deterministic helpers.
 * Natural-language business intents never route through decideBusinessTool().
 */

import type {
  BusinessToolDecision,
  DecideBusinessToolOptions,
} from '@/lib/ai/decision-engine';
import {
  createRedisIntentDraftStore,
  draftSummary,
  type IntentDraftStore,
} from '@/lib/ai/intent/draft-store';
import {
  DRAFT_CANCELLED_MESSAGE,
  DRAFT_FOLLOWUP_UNAVAILABLE_CLARIFY,
  enforceStructuredIntentDetailed,
  type EnforceIntentOptions,
} from '@/lib/ai/intent/enforce';
import {
  extractStructuredIntent,
  type ExtractIntentFn,
} from '@/lib/ai/intent/extract';
import { isExplicitDraftCancelPhrase } from '@/lib/ai/intent/follow-up';
import type { IntentDraft, StructuredIntent } from '@/lib/ai/intent/types';
import {
  isBareCancelPhrase,
  isBareConfirmPhrase,
  resolveConfirmOrCancel,
} from '@/lib/ai/write-decision';

/** Controlled response when structured extraction fails technically. */
export const EXTRACTION_FAILED_MESSAGE_TH =
  'ตอนนี้ยังไม่สามารถทำความเข้าใจคำขอได้ครับ กรุณาลองส่งอีกครั้ง โดยระบุวันที่ Project งาน และจำนวนชั่วโมงให้ครบถ้วน';

export const EXTRACTION_FAILED_MESSAGE_EN =
  'I couldn’t understand that request right now. Please try again with the date, project, task, and hours.';

export type DecideWithIntentOptions = DecideBusinessToolOptions & {
  conversationId?: string;
  slackUserId?: string;
  requestId?: string;
  eventId?: string;
  extractIntent?: ExtractIntentFn;
  draftStore?: IntentDraftStore;
  resolveProjectFn?: EnforceIntentOptions['resolveProjectFn'];
  resolveTaskFn?: EnforceIntentOptions['resolveTaskFn'];
};

export type ExtractionOutcome =
  | 'extraction_succeeded'
  | 'extraction_failed'
  | 'skipped_deterministic'
  | 'clarification_required'
  | 'general_conversation'
  | 'business_tool_selected'
  | 'draft_store_unavailable';

export type DecideWithIntentResult = {
  decision: BusinessToolDecision;
  extractionOutcome: ExtractionOutcome;
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

function extractionFailureDecision(): BusinessToolDecision {
  return {
    action: 'clarify',
    message: EXTRACTION_FAILED_MESSAGE_TH,
    reason: 'extraction_failed',
  };
}

/**
 * Production entry: bare confirm/cancel → AI structured extraction → enforce.
 * Never calls decideBusinessTool for natural-language business routing.
 */
export async function decideWithIntentExtraction(
  userMessage: string,
  options: DecideWithIntentOptions = {}
): Promise<DecideWithIntentResult> {
  const text = userMessage?.trim() || '';
  const now = options.now ?? new Date();
  const pending = options.pendingChanges ?? [];

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
        extractionOutcome: 'skipped_deterministic',
        selectedTool:
          cc.action === 'call_tool' ? cc.toolName : undefined,
        clarificationReason: cc.action === 'clarify' ? cc.reason : undefined,
      });
      return {
        decision: cc,
        extractionOutcome: 'skipped_deterministic',
        draftStoreAvailable: true,
      };
    }

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
          extractionOutcome: 'skipped_deterministic',
          draftOutcome: 'draft_cleared',
          draftStoreAvailable: draftLoad.available,
        };
      }
      if (cc) {
        return {
          decision: cc,
          extractionOutcome: 'skipped_deterministic',
          draftStoreAvailable: draftLoad.available,
        };
      }
    }

    if (cc) {
      return {
        decision: cc,
        extractionOutcome: 'skipped_deterministic',
      };
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
        extractionOutcome: 'draft_store_unavailable',
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
      extractionOutcome: 'skipped_deterministic',
      draftOutcome: 'draft_cleared',
      draftStoreAvailable: true,
    };
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

    const extractionOutcome: ExtractionOutcome =
      enforced.decision.reason === 'draft_store_unavailable'
        ? 'draft_store_unavailable'
        : enforced.decision.action === 'call_tool'
          ? 'business_tool_selected'
          : enforced.decision.action === 'clarify'
            ? 'clarification_required'
            : enforced.decision.reason === 'general_conversation'
              ? 'general_conversation'
              : 'extraction_succeeded';

    logIntent({
      message: 'intent_enforced',
      requestId: options.requestId,
      eventId: options.eventId,
      conversationId: options.conversationId,
      extractionOutcome: 'extraction_succeeded',
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
      extractionOutcome,
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
      message: 'intent_extraction_failed',
      requestId: options.requestId,
      eventId: options.eventId,
      conversationId: options.conversationId,
      extractionOutcome: 'extraction_failed',
      typedErrorCode,
      draftStoreAvailable: draftLoad.available,
      error: error instanceof Error ? error.message : 'unknown',
    });

    // Fail closed — never call decideBusinessTool / Business Tools / invent identity errors
    return {
      decision: extractionFailureDecision(),
      extractionOutcome: 'extraction_failed',
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

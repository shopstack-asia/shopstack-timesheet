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
  enforceStructuredIntent,
  looksLikeBusinessTimesheetText,
  type EnforceIntentOptions,
} from '@/lib/ai/intent/enforce';
import {
  extractStructuredIntent,
  type ExtractIntentFn,
} from '@/lib/ai/intent/extract';
import type { StructuredIntent } from '@/lib/ai/intent/types';
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

  // Narrow deterministic confirm/cancel always first
  if (isBareConfirmPhrase(text) || isBareCancelPhrase(text)) {
    const cc = resolveConfirmOrCancel(text, pending);
    if (cc) {
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
      return { decision: cc, fallbackUsed: false };
    }
  }

  if (!enabled || options.forceRegexFallback) {
    const decision = decideBusinessTool(text, { now, pendingChanges: pending });
    return { decision, fallbackUsed: !enabled };
  }

  const draftStore =
    options.draftStore ??
    (options.conversationId ? createRedisIntentDraftStore() : undefined);

  let draft =
    draftStore && options.conversationId && options.slackUserId
      ? await draftStore.get(options.conversationId, options.slackUserId)
      : undefined;

  const extract = options.extractIntent ?? extractStructuredIntent;

  try {
    const extracted = await extract({
      userMessage: text,
      draftSummary: draft ? draftSummary(draft) : undefined,
      requestId: options.requestId,
      eventId: options.eventId,
    });

    const decision = await enforceStructuredIntent(extracted, {
      now,
      pendingChanges: pending,
      draft,
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
        decision.action === 'call_tool' ? decision.toolName : undefined,
      clarificationReason:
        decision.action === 'clarify' ? decision.reason : undefined,
      fallbackUsed: false,
      toolResultStatus: decision.action,
    });

    return { decision, fallbackUsed: false, extractedIntent: extracted };
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
      error: error instanceof Error ? error.message : 'unknown',
    });

    const decision = decideBusinessTool(text, { now, pendingChanges: pending });

    // Uncertain timesheet language must not become general conversation
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
      };
    }

    return { decision, fallbackUsed: true, typedErrorCode };
  }
}

/**
 * TEST-ONLY helper: wraps the legacy decideBusinessTool regex engine as a
 * decideWithIntent double so integration tests can avoid live OpenAI extraction.
 *
 * Production conversation never uses this path for natural-language routing.
 */

import {
  decideBusinessTool,
  type DecideBusinessToolOptions,
} from '@/lib/ai/decision-engine';
import type {
  DecideWithIntentOptions,
  DecideWithIntentResult,
} from '@/lib/ai/intent/decide';

export async function decideWithIntentViaRegexForTests(
  userMessage: string,
  options: DecideWithIntentOptions = {}
): Promise<DecideWithIntentResult> {
  const syncOpts: DecideBusinessToolOptions = {
    now: options.now,
    pendingChanges: options.pendingChanges,
  };
  const decision = decideBusinessTool(userMessage, syncOpts);
  return {
    decision,
    extractionOutcome:
      decision.action === 'call_tool'
        ? 'business_tool_selected'
        : decision.action === 'clarify'
          ? 'clarification_required'
          : 'general_conversation',
  };
}

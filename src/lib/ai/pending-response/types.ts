/**
 * Semantic pending-confirmation response types.
 * The model proposes meaning; application code authorizes actions.
 */

export type PendingResponseIntentKind =
  | 'confirm'
  | 'cancel'
  | 'correction'
  | 'unrelated'
  | 'ambiguous';

export type PendingResponseCorrection = {
  dateHint?: string;
  projectHint?: string;
  taskHint?: string;
  hours?: number;
};

/** Strict structured object returned by the semantic extractor (after Zod). */
export type PendingResponseExtraction = {
  intent: PendingResponseIntentKind;
  confidence: number;
  hasNewMutation: boolean;
  correction: PendingResponseCorrection | null;
  reasonCode: string;
};

/**
 * Safe proposal context shown to the model — no identity, Redis keys,
 * confirmation IDs, fencing tokens, or snapshot internals.
 */
export type SafePendingProposalContext = {
  operation: string;
  date?: string;
  projectName?: string;
  taskName?: string;
  hours?: number;
  fromHours?: number;
  toHours?: number;
  /** Human-readable confirmation lines (IDs stripped). */
  summaryText: string;
};

export type PendingResponseExtractorOutcome =
  | 'extracted'
  | 'empty_response'
  | 'invalid_json'
  | 'schema_invalid'
  | 'identity_forbidden'
  | 'timeout'
  | 'transport_error'
  | 'unknown_error';

export type PendingResponseEnforcementOutcome =
  | 'confirm_authorized'
  | 'cancel_authorized'
  | 'correction_prepare'
  | 'correction_clarify'
  | 'unrelated_passthrough'
  | 'clarify_ambiguous'
  | 'clarify_low_confidence'
  | 'clarify_conflict'
  | 'clarify_extractor_failure'
  | 'ownership_denied'
  | 'no_owned_pending';

/** Conservative confirm confidence threshold (documented). */
export const PENDING_CONFIRM_CONFIDENCE_THRESHOLD = 0.75;

export function confidenceBand(
  confidence: number
): 'high' | 'medium' | 'low' | 'none' {
  if (!Number.isFinite(confidence)) return 'none';
  if (confidence >= PENDING_CONFIRM_CONFIDENCE_THRESHOLD) return 'high';
  if (confidence >= 0.5) return 'medium';
  if (confidence > 0) return 'low';
  return 'none';
}

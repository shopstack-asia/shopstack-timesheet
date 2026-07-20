import {
  confidenceBand,
  type PendingResponseEnforcementOutcome,
  type PendingResponseExtractorOutcome,
} from '@/lib/ai/pending-response/types';

/**
 * Structured, non-sensitive audit for pending-response handling.
 * Never log employee identity, proposal snapshots, Redis keys, or raw user text.
 */
export function logPendingResponseAudit(event: {
  requestId?: string;
  eventId?: string;
  conversationId?: string;
  pendingResponseOutcome:
    | 'no_pending'
    | 'semantic_handled'
    | 'ownership_denied'
    | 'store_unavailable'
    | 'skipped';
  extractorOutcome?: PendingResponseExtractorOutcome;
  enforcementOutcome?: PendingResponseEnforcementOutcome;
  toolOutcome?: string;
  confidence?: number;
  selectedTool?: string;
}): void {
  console.log(
    JSON.stringify({
      scope: 'ai-pending-response',
      level: 'info',
      ts: new Date().toISOString(),
      requestId: event.requestId,
      eventId: event.eventId,
      // conversationId is an opaque Slack conversation key (not employee PII)
      conversationId: event.conversationId,
      pendingResponseOutcome: event.pendingResponseOutcome,
      extractorOutcome: event.extractorOutcome,
      confidenceBand:
        event.confidence !== undefined
          ? confidenceBand(event.confidence)
          : undefined,
      enforcementOutcome: event.enforcementOutcome,
      toolOutcome: event.toolOutcome,
      selectedTool: event.selectedTool,
    })
  );
}

/**
 * AI-first structured intent types for the Slack Timesheet Agent.
 * Identity fields are never part of extracted intent or drafts.
 */

export type IntentDomain = 'timesheet' | 'profile' | 'work_context' | 'general' | 'unknown';

export type StructuredIntentName =
  | 'get_my_profile'
  | 'get_work_context'
  | 'get_timesheet_day'
  | 'get_timesheet_range'
  | 'create_timesheet_entry'
  | 'update_timesheet_entry'
  | 'delete_timesheet_entry'
  | 'confirm_timesheet_change'
  | 'cancel_timesheet_change'
  | 'submit_timesheet'
  | 'general_conversation'
  | 'unknown';

export type IntentConfidence = 'high' | 'medium' | 'low';

export type IntentMissingField =
  | 'date'
  | 'project'
  | 'task'
  | 'hours'
  | 'confirmationId'
  | 'range'
  | 'matchEntry';

/** AI-proposed structured intent (proposal only — not authorization). */
export type StructuredIntent = {
  domain: IntentDomain;
  intent: StructuredIntentName;
  confidence: IntentConfidence;
  dateExpression?: string | null;
  startDateExpression?: string | null;
  endDateExpression?: string | null;
  projectHint?: string | null;
  taskHint?: string | null;
  hours?: number | null;
  confirmationId?: string | null;
  missingFields: IntentMissingField[];
  ambiguities: string[];
  refersToPrevious?: boolean;
};

/** Safe multi-turn draft — no employee identity. */
export type IntentDraft = {
  intent: StructuredIntentName;
  dateExpression?: string;
  resolvedDate?: string;
  projectHint?: string;
  resolvedProjectId?: string;
  taskHint?: string;
  resolvedTaskId?: string;
  hours?: number;
  missingFields: IntentMissingField[];
  ambiguities?: string[];
  /** Loop prevention — last asked slot */
  lastClarificationField?: string;
  lastClarificationReason?: string;
  clarificationCount?: number;
  lastUserAnswerNorm?: string;
  lastResolutionOutcome?: string;
  conversationId: string;
  slackUserId: string;
  createdAt: string;
  expiresAt: string;
};

export type AgentTypedErrorCode =
  | 'identity_unavailable'
  | 'context_unavailable'
  | 'redis_unavailable'
  | 'draft_store_unavailable'
  | 'project_not_found'
  | 'task_not_found'
  | 'project_ambiguous'
  | 'task_ambiguous'
  | 'ambiguous_project'
  | 'ambiguous_task'
  | 'project_missing'
  | 'task_missing'
  | 'hours_missing'
  | 'date_missing'
  | 'validation_failed'
  | 'confirmation_expired'
  | 'confirmation_conflict'
  | 'write_failed'
  | 'read_failed'
  | 'extraction_failed'
  | 'malformed_intent';

export class AgentTypedError extends Error {
  readonly code: AgentTypedErrorCode;
  readonly safeMessage: string;

  constructor(code: AgentTypedErrorCode, safeMessage: string) {
    super(safeMessage);
    this.name = 'AgentTypedError';
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

export const INTENT_DRAFT_TTL_SECONDS = 10 * 60;

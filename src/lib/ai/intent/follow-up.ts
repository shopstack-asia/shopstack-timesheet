/**
 * Deterministic Intent Draft follow-up state machine.
 * AI proposes semantics; this module decides merge / clarify / general / cancel.
 */

import {
  parseHoursValue,
  resolveDateExpression,
  isValidIsoDate,
} from '@/lib/ai/intent/date-resolve';
import type {
  IntentDraft,
  IntentMissingField,
  StructuredIntent,
  StructuredIntentName,
} from '@/lib/ai/intent/types';
import {
  formatProjectLabel,
  formatTaskLabel,
  resolveProject,
  resolveTask,
} from '@/lib/timesheet/write/master-resolve';

const EXPLICIT_DRAFT_CANCEL_RE =
  /^(ยกเลิกคำขอนี้|ไม่ลงเวลาแล้ว|cancel this draft|cancel the draft|ล้างคำขอ|ไม่ทำต่อแล้ว)[\s!.?]*$/i;

const EXPLICIT_CONTINUE_RE =
  /(ต่อจากเมื่อกี้|ตามที่ขอ|ตามที่ค้าง|continue (the )?draft|same (request|timesheet)|เพิ่มเติมตามเดิม)/i;

/** Conservative safety layer only — not the primary NLU classifier. */
const UNRELATED_GENERAL_RE =
  /^(ขอบคุณ|ขอบใจ|โอเค|ok|okay|สวัสดี|hello|hi|hey|เล่าเรื่อง|what is|what's|explain|ช่วยเขียน|อากาศ|weather|how are you|ดีจ้า|ครับ|ค่ะ)([\s!.?].*)?$/i;

const WRITE_INTENTS = new Set<StructuredIntentName>([
  'create_timesheet_entry',
  'update_timesheet_entry',
  'delete_timesheet_entry',
]);

const PRIMARY_FIELDS: IntentMissingField[] = [
  'date',
  'project',
  'task',
  'hours',
];

export function isExplicitDraftCancelPhrase(text: string): boolean {
  return EXPLICIT_DRAFT_CANCEL_RE.test(text.trim());
}

export function isExplicitDraftContinuePhrase(text: string): boolean {
  return EXPLICIT_CONTINUE_RE.test(text.trim());
}

export function isUnrelatedGeneralPhrase(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (UNRELATED_GENERAL_RE.test(t)) return true;
  if (
    /เล่าเรื่องแมว|ช่วยเขียน\s*typescript|what is a timesheet|what is project management|อากาศวันนี้|weather (today|now)/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

export function normalizeAnswerKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Soft task hint from follow-up text (e.g. "RMS เป็น PM" → "PM"). */
export function extractTaskHintFromFollowUp(hint: string): string {
  const asTask = hint.match(
    /(?:เป็น|ในฐานะ|ใช้|as|under)\s+([A-Za-z0-9ก-๙][A-Za-z0-9ก-๙ ._/&-]{0,40})/i
  );
  if (asTask?.[1]) {
    return asTask[1].trim().replace(/[.,!?]+$/u, '');
  }
  return hint.trim();
}

/**
 * Hours for an outstanding hours slot — named units or a bare 1–24 number.
 */
export function parseHoursForOutstandingSlot(text: string): number | undefined {
  const named = parseHoursValue(undefined, text);
  if (named !== undefined) return named;
  const bare = text.trim().match(/^(\d+(?:\.\d+)?)$/);
  if (!bare?.[1]) return undefined;
  const n = Number(bare[1]);
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : undefined;
}

export type TargetResolution =
  | {
      status: 'resolved';
      targetField: 'date';
      dateExpression: string;
      resolvedDate: string;
    }
  | {
      status: 'resolved';
      targetField: 'project';
      projectHint: string;
      resolvedProjectId: string;
    }
  | {
      status: 'resolved';
      targetField: 'task';
      taskHint: string;
      resolvedTaskId: string;
    }
  | {
      status: 'resolved';
      targetField: 'hours';
      hours: number;
    }
  | {
      status: 'ambiguous';
      targetField: 'project' | 'task';
      hint: string;
      candidateIds: string[];
      candidateLabels: string[];
    }
  | {
      status: 'not_found';
      targetField: 'project' | 'task';
      hint: string;
    }
  | {
      status: 'invalid';
      targetField: 'date' | 'hours';
    }
  | {
      status: 'unavailable';
      targetField: 'project' | 'task';
    };

export type DraftMergeMode =
  | 'targeted_follow_up'
  | 'preserve_draft'
  | 'no_merge';

export type DraftMergeResult = {
  intent: StructuredIntent;
  draftPatch: Partial<IntentDraft>;
  mergeMode: DraftMergeMode;
  targetField: IntentMissingField | null;
  modelProvidedFields: string[];
  appliedField: IntentMissingField | null;
  ignoredConflictingFields: string[];
  preservedDraftFields: string[];
  mergeReason?: string;
};

/**
 * Outcome of the Draft follow-up state machine.
 */
export type DraftMergeOutcome =
  | {
      kind: 'merge_resolved';
      reason: string;
      resolution: Extract<TargetResolution, { status: 'resolved' }>;
      modelClassificationOverridden?: boolean;
      candidateResolution: 'resolved';
      targetField: IntentMissingField;
    }
  | {
      kind: 'clarify_with_hint';
      reason: string;
      resolution: Extract<
        TargetResolution,
        { status: 'ambiguous' | 'not_found' }
      >;
      modelClassificationOverridden?: boolean;
      showCandidates: boolean;
      candidateResolution: 'ambiguous' | 'not_found';
      targetField: IntentMissingField;
      draftMutated: true;
    }
  | {
      kind: 'clarify_target';
      reason: string;
      targetField: IntentMissingField;
      candidateResolution: 'invalid' | 'not_found';
      modelClassificationOverridden?: boolean;
      draftMutated: false;
    }
  | {
      kind: 'clarify_missing_list';
      reason: string;
      missingFields: IntentMissingField[];
      draftMutated: false;
    }
  | {
      kind: 'general';
      reason:
        | 'general_conversation'
        | 'general_conversation_unmatched'
        | 'unrelated_general_phrase';
      targetField?: IntentMissingField | null;
      candidateResolution?: string;
      draftMutated: false;
    }
  | {
      kind: 'dependency';
      reason: 'master_data_unavailable';
      targetField: 'project' | 'task';
      candidateResolution: 'unavailable';
      draftMutated: false;
    }
  | {
      kind: 'no_merge';
      reason: string;
      targetField?: IntentMissingField | null;
      draftMutated: false;
    }
  | {
      kind: 'explicit_cancel';
      reason: 'explicit_cancel';
      draftMutated: false;
    }
  | {
      kind: 'intent_mismatch';
      reason: 'intent_mismatch';
      draftMutated: false;
    }
  | {
      kind: 'empty';
      reason: 'empty_message';
      draftMutated: false;
    };

/** @deprecated Use DraftMergeOutcome; kept for narrow call-site adapters. */
export type MergeDecision =
  | { merge: false; reason: string; outcome: DraftMergeOutcome }
  | {
      merge: true;
      reason: string;
      outcome: DraftMergeOutcome;
      modelClassificationOverridden?: boolean;
    };

function primaryOutstandingFields(draft: IntentDraft): IntentMissingField[] {
  return draft.missingFields.filter((f) => PRIMARY_FIELDS.includes(f));
}

/**
 * Target from trusted Draft only — never model missingFields / wrong-slot hints.
 */
export function selectTargetField(
  draft: IntentDraft
): IntentMissingField | null {
  const primary = primaryOutstandingFields(draft);
  if (primary.length === 1) return primary[0]!;
  const last = draft.lastClarificationField;
  if (
    last &&
    PRIMARY_FIELDS.includes(last as IntentMissingField) &&
    primary.includes(last as IntentMissingField)
  ) {
    return last as IntentMissingField;
  }
  return null;
}

/** Alias used by older tests/docs. */
export function outstandingMergeTarget(
  draft: IntentDraft
): IntentMissingField | null {
  return selectTargetField(draft);
}

function modelProvidedFields(intent: StructuredIntent): string[] {
  const fields: string[] = [];
  if (intent.dateExpression?.trim()) fields.push('date');
  if (intent.projectHint?.trim()) fields.push('project');
  if (intent.taskHint?.trim()) fields.push('task');
  if (intent.hours != null) fields.push('hours');
  return fields;
}

/**
 * Evaluate the raw user answer against the single outstanding target.
 * Canonical master resolution is evidence for Project/Task — not message length.
 */
export async function evaluateTargetAnswer(input: {
  targetField: IntentMissingField;
  userMessage: string;
  now: Date;
  resolveProjectFn?: typeof resolveProject;
  resolveTaskFn?: typeof resolveTask;
}): Promise<TargetResolution> {
  const hint = input.userMessage.trim();
  const resolveProj = input.resolveProjectFn ?? resolveProject;
  const resolveTk = input.resolveTaskFn ?? resolveTask;

  if (input.targetField === 'hours') {
    const hours = parseHoursForOutstandingSlot(hint);
    if (hours === undefined) return { status: 'invalid', targetField: 'hours' };
    return { status: 'resolved', targetField: 'hours', hours };
  }

  if (input.targetField === 'date') {
    const resolvedDate = resolveDateExpression(hint, input.now);
    if (!resolvedDate) return { status: 'invalid', targetField: 'date' };
    return {
      status: 'resolved',
      targetField: 'date',
      dateExpression: hint,
      resolvedDate,
    };
  }

  if (input.targetField === 'task') {
    const taskHint = extractTaskHintFromFollowUp(hint);
    try {
      const result = await resolveTk({ taskName: taskHint });
      if (result.status === 'resolved') {
        return {
          status: 'resolved',
          targetField: 'task',
          taskHint,
          resolvedTaskId: result.value.TaskID,
        };
      }
      if (result.status === 'ambiguous') {
        return {
          status: 'ambiguous',
          targetField: 'task',
          hint: taskHint,
          candidateIds: result.candidates.map((t) => t.TaskID),
          candidateLabels: result.candidates.map((t) => formatTaskLabel(t)),
        };
      }
      return { status: 'not_found', targetField: 'task', hint: taskHint };
    } catch {
      return { status: 'unavailable', targetField: 'task' };
    }
  }

  if (input.targetField === 'project') {
    try {
      const result = await resolveProj({ projectName: hint });
      if (result.status === 'resolved') {
        return {
          status: 'resolved',
          targetField: 'project',
          projectHint: hint,
          resolvedProjectId: result.value.ProjectID,
        };
      }
      if (result.status === 'ambiguous') {
        return {
          status: 'ambiguous',
          targetField: 'project',
          hint,
          candidateIds: result.candidates.map((p) => p.ProjectID),
          candidateLabels: result.candidates.map((p) => formatProjectLabel(p)),
        };
      }
      return { status: 'not_found', targetField: 'project', hint };
    } catch {
      return { status: 'unavailable', targetField: 'project' };
    }
  }

  return { status: 'invalid', targetField: 'hours' };
}

function isSameWriteIntent(
  intent: StructuredIntent,
  draft: IntentDraft
): boolean {
  return WRITE_INTENTS.has(intent.intent) && intent.intent === draft.intent;
}

function isDifferentWriteIntent(
  intent: StructuredIntent,
  draft: IntentDraft
): boolean {
  return (
    WRITE_INTENTS.has(intent.intent) &&
    WRITE_INTENTS.has(draft.intent) &&
    intent.intent !== draft.intent
  );
}

function toMergeDecision(outcome: DraftMergeOutcome): MergeDecision {
  if (outcome.kind === 'merge_resolved') {
    return {
      merge: true,
      reason: outcome.reason,
      outcome,
      modelClassificationOverridden: outcome.modelClassificationOverridden,
    };
  }
  return { merge: false, reason: outcome.reason, outcome };
}

/**
 * Exact Draft follow-up state machine (PR #16 specification).
 */
export async function decideDraftMerge(input: {
  intent: StructuredIntent;
  draft: IntentDraft;
  userMessage: string;
  now?: Date;
  resolveProjectFn?: typeof resolveProject;
  resolveTaskFn?: typeof resolveTask;
}): Promise<MergeDecision> {
  const { intent, draft, userMessage } = input;
  const trimmed = userMessage.trim();
  const now = input.now ?? new Date();
  const explicitCancel = isExplicitDraftCancelPhrase(trimmed);
  const knownUnrelated = isUnrelatedGeneralPhrase(trimmed);
  const explicitContinue = isExplicitDraftContinuePhrase(trimmed);
  const modelRefers = intent.refersToPrevious === true;
  const continuation = explicitContinue || modelRefers;

  // STEP 1
  if (!trimmed) {
    return toMergeDecision({
      kind: 'empty',
      reason: 'empty_message',
      draftMutated: false,
    });
  }

  // STEP 2
  if (explicitCancel) {
    return toMergeDecision({
      kind: 'explicit_cancel',
      reason: 'explicit_cancel',
      draftMutated: false,
    });
  }

  // STEP 3
  if (knownUnrelated && !continuation) {
    return toMergeDecision({
      kind: 'general',
      reason: 'unrelated_general_phrase',
      draftMutated: false,
    });
  }

  // STEP 4
  const targetField = selectTargetField(draft);
  if (!targetField) {
    if (intent.intent === 'general_conversation') {
      return toMergeDecision({
        kind: 'general',
        reason: 'general_conversation',
        targetField: null,
        draftMutated: false,
      });
    }
    if (intent.intent === 'unknown') {
      return toMergeDecision({
        kind: 'no_merge',
        reason: 'no_merge_signal',
        targetField: null,
        draftMutated: false,
      });
    }
    if (isSameWriteIntent(intent, draft)) {
      return toMergeDecision({
        kind: 'clarify_missing_list',
        reason: 'multiple_missing_fields',
        missingFields: primaryOutstandingFields(draft),
        draftMutated: false,
      });
    }
    if (isDifferentWriteIntent(intent, draft) && !continuation) {
      return toMergeDecision({
        kind: 'intent_mismatch',
        reason: 'intent_mismatch',
        draftMutated: false,
      });
    }
    return toMergeDecision({
      kind: 'no_merge',
      reason: 'no_merge_signal',
      targetField: null,
      draftMutated: false,
    });
  }

  // CASE E before evaluation when different write and no continuation
  if (isDifferentWriteIntent(intent, draft) && !continuation) {
    return toMergeDecision({
      kind: 'intent_mismatch',
      reason: 'intent_mismatch',
      draftMutated: false,
    });
  }

  // STEP 5
  const resolution = await evaluateTargetAnswer({
    targetField,
    userMessage: trimmed,
    now,
    resolveProjectFn: input.resolveProjectFn,
    resolveTaskFn: input.resolveTaskFn,
  });

  // CASE A — continuation signal
  if (continuation) {
    return toMergeDecision(
      applyCaseA(resolution, targetField, {
        reason: explicitContinue ? 'explicit_continue' : 'refers_to_previous',
      })
    );
  }

  // CASE B — general_conversation, no continuation
  if (intent.intent === 'general_conversation') {
    return toMergeDecision(applyCaseB(resolution, targetField));
  }

  // CASE C — unknown, no continuation
  if (intent.intent === 'unknown') {
    return toMergeDecision(applyCaseC(resolution, targetField));
  }

  // CASE D — same write intent
  if (isSameWriteIntent(intent, draft)) {
    return toMergeDecision(applyCaseD(resolution, targetField, modelRefers));
  }

  // Other intents with a target but no continuation
  return toMergeDecision({
    kind: 'no_merge',
    reason: 'no_merge_signal',
    targetField,
    draftMutated: false,
  });
}

function applyCaseA(
  resolution: TargetResolution,
  targetField: IntentMissingField,
  signals: { reason: string }
): DraftMergeOutcome {
  if (resolution.status === 'resolved') {
    return {
      kind: 'merge_resolved',
      reason: signals.reason,
      resolution,
      candidateResolution: 'resolved',
      targetField,
    };
  }
  if (resolution.status === 'ambiguous') {
    return {
      kind: 'clarify_with_hint',
      reason: 'candidate_ambiguous',
      resolution,
      showCandidates: true,
      candidateResolution: 'ambiguous',
      targetField,
      draftMutated: true,
    };
  }
  if (resolution.status === 'not_found') {
    return {
      kind: 'clarify_with_hint',
      reason: 'candidate_not_found',
      resolution,
      showCandidates: true,
      candidateResolution: 'not_found',
      targetField,
      draftMutated: true,
    };
  }
  if (resolution.status === 'invalid') {
    return {
      kind: 'clarify_target',
      reason: 'candidate_invalid',
      targetField,
      candidateResolution: 'invalid',
      draftMutated: false,
    };
  }
  return {
    kind: 'dependency',
    reason: 'master_data_unavailable',
    targetField: resolution.targetField,
    candidateResolution: 'unavailable',
    draftMutated: false,
  };
}

function applyCaseB(
  resolution: TargetResolution,
  targetField: IntentMissingField
): DraftMergeOutcome {
  if (resolution.status === 'resolved') {
    return {
      kind: 'merge_resolved',
      reason: 'structural_follow_up_overrode_general',
      resolution,
      modelClassificationOverridden: true,
      candidateResolution: 'resolved',
      targetField,
    };
  }
  if (resolution.status === 'ambiguous') {
    return {
      kind: 'clarify_with_hint',
      reason: 'structural_follow_up_overrode_general',
      resolution,
      modelClassificationOverridden: true,
      showCandidates: true,
      candidateResolution: 'ambiguous',
      targetField,
      draftMutated: true,
    };
  }
  if (resolution.status === 'not_found' || resolution.status === 'invalid') {
    return {
      kind: 'general',
      reason: 'general_conversation_unmatched',
      targetField,
      candidateResolution: resolution.status,
      draftMutated: false,
    };
  }
  return {
    kind: 'dependency',
    reason: 'master_data_unavailable',
    targetField: resolution.targetField,
    candidateResolution: 'unavailable',
    draftMutated: false,
  };
}

function applyCaseC(
  resolution: TargetResolution,
  targetField: IntentMissingField
): DraftMergeOutcome {
  if (resolution.status === 'resolved') {
    return {
      kind: 'merge_resolved',
      reason: 'structural_follow_up_overrode_unknown',
      resolution,
      modelClassificationOverridden: true,
      candidateResolution: 'resolved',
      targetField,
    };
  }
  if (resolution.status === 'ambiguous') {
    return {
      kind: 'clarify_with_hint',
      reason: 'candidate_ambiguous',
      resolution,
      showCandidates: true,
      candidateResolution: 'ambiguous',
      targetField,
      draftMutated: true,
    };
  }
  if (resolution.status === 'not_found') {
    return {
      kind: 'clarify_target',
      reason: 'outstanding_slot_unmatched',
      targetField,
      candidateResolution: 'not_found',
      draftMutated: false,
    };
  }
  if (resolution.status === 'invalid') {
    return {
      kind: 'clarify_target',
      reason: 'outstanding_slot_unmatched',
      targetField,
      candidateResolution: 'invalid',
      draftMutated: false,
    };
  }
  return {
    kind: 'dependency',
    reason: 'master_data_unavailable',
    targetField: resolution.targetField,
    candidateResolution: 'unavailable',
    draftMutated: false,
  };
}

function applyCaseD(
  resolution: TargetResolution,
  targetField: IntentMissingField,
  modelRefers: boolean
): DraftMergeOutcome {
  if (resolution.status === 'resolved') {
    return {
      kind: 'merge_resolved',
      reason: 'same_write_intent_with_slots',
      resolution,
      candidateResolution: 'resolved',
      targetField,
    };
  }
  if (resolution.status === 'ambiguous') {
    return {
      kind: 'clarify_with_hint',
      reason: 'candidate_ambiguous',
      resolution,
      showCandidates: true,
      candidateResolution: 'ambiguous',
      targetField,
      draftMutated: true,
    };
  }
  if (resolution.status === 'not_found') {
    // Preserve hint when raw clearly answers target (we always have a hint) or modelRefers
    if (modelRefers || resolution.hint.trim()) {
      return {
        kind: 'clarify_with_hint',
        reason: 'candidate_not_found',
        resolution,
        showCandidates: true,
        candidateResolution: 'not_found',
        targetField,
        draftMutated: true,
      };
    }
    return {
      kind: 'clarify_target',
      reason: 'outstanding_slot_unmatched',
      targetField,
      candidateResolution: 'not_found',
      draftMutated: false,
    };
  }
  if (resolution.status === 'invalid') {
    return {
      kind: 'clarify_target',
      reason: 'candidate_invalid',
      targetField,
      candidateResolution: 'invalid',
      draftMutated: false,
    };
  }
  return {
    kind: 'dependency',
    reason: 'master_data_unavailable',
    targetField: resolution.targetField,
    candidateResolution: 'unavailable',
    draftMutated: false,
  };
}

/**
 * Strict target-only merge from a validated TargetResolution.
 * Does not guess field placement from model hints.
 */
export function applyDraftMerge(
  intent: StructuredIntent,
  draft: IntentDraft,
  resolution: Extract<
    TargetResolution,
    { status: 'resolved' | 'ambiguous' | 'not_found' }
  >,
  options?: { mergeReason?: string }
): DraftMergeResult {
  const provided = modelProvidedFields(intent);
  const target = resolution.targetField;

  const dateExpression = draft.dateExpression || draft.resolvedDate || null;
  const projectHint = draft.projectHint ?? null;
  const taskHint = draft.taskHint ?? null;
  const hours = draft.hours ?? null;

  const preservedDraftFields = (
    ['date', 'project', 'task', 'hours'] as const
  ).filter((f) => f !== target);

  let nextDate = dateExpression;
  let nextProject = projectHint;
  let nextTask = taskHint;
  let nextHours = hours;
  const draftPatch: Partial<IntentDraft> = {};

  if (resolution.status === 'resolved') {
    if (resolution.targetField === 'date') {
      nextDate = resolution.dateExpression;
      draftPatch.dateExpression = resolution.dateExpression;
      draftPatch.resolvedDate = resolution.resolvedDate;
    } else if (resolution.targetField === 'project') {
      nextProject = resolution.projectHint;
      draftPatch.projectHint = resolution.projectHint;
      draftPatch.resolvedProjectId = resolution.resolvedProjectId;
    } else if (resolution.targetField === 'task') {
      nextTask = resolution.taskHint;
      draftPatch.taskHint = resolution.taskHint;
      draftPatch.resolvedTaskId = resolution.resolvedTaskId;
    } else if (resolution.targetField === 'hours') {
      nextHours = resolution.hours;
      draftPatch.hours = resolution.hours;
    }
  } else if (resolution.status === 'ambiguous' || resolution.status === 'not_found') {
    if (resolution.targetField === 'project') {
      nextProject = resolution.hint;
      draftPatch.projectHint = resolution.hint;
      draftPatch.resolvedProjectId = undefined;
    } else {
      nextTask = resolution.hint;
      draftPatch.taskHint = resolution.hint;
      draftPatch.resolvedTaskId = undefined;
    }
  }

  const ignored = provided.filter((f) => f !== target);

  return {
    intent: {
      ...intent,
      domain: 'timesheet',
      intent: draft.intent,
      dateExpression: nextDate,
      projectHint: nextProject,
      taskHint: nextTask,
      hours: nextHours,
      refersToPrevious: true,
      missingFields: [],
      ambiguities: intent.ambiguities ?? draft.ambiguities ?? [],
    },
    draftPatch,
    mergeMode: 'targeted_follow_up',
    targetField: target,
    modelProvidedFields: provided,
    appliedField: target,
    ignoredConflictingFields: ignored,
    preservedDraftFields: [...preservedDraftFields],
    mergeReason: options?.mergeReason,
  };
}

export function recomputeCreateMissingFields(slots: {
  date?: string | null;
  resolvedDate?: string | null;
  hours?: number | null;
  projectHint?: string | null;
  resolvedProjectId?: string | null;
  taskHint?: string | null;
  resolvedTaskId?: string | null;
}): IntentMissingField[] {
  return computeCanonicalCreateMissingFields(slots);
}

/**
 * Canonical create-slot completion.
 *
 * - Date completes only with a valid resolvedDate (YYYY-MM-DD)
 * - Project completes only with resolvedProjectId (hints never complete)
 * - Task completes only with resolvedTaskId (hints never complete)
 * - Hours completes only with a finite value in (0, 24]
 *
 * Hints are diagnostic/clarification state only.
 */
export function computeCanonicalCreateMissingFields(slots: {
  date?: string | null;
  resolvedDate?: string | null;
  hours?: number | null;
  projectHint?: string | null;
  resolvedProjectId?: string | null;
  taskHint?: string | null;
  resolvedTaskId?: string | null;
}): IntentMissingField[] {
  const missing: IntentMissingField[] = [];
  const resolvedDate = (slots.resolvedDate || slots.date || '').trim();
  if (!resolvedDate || !isValidIsoDate(resolvedDate)) {
    missing.push('date');
  }
  if (!slots.resolvedProjectId?.trim()) {
    missing.push('project');
  }
  if (!slots.resolvedTaskId?.trim()) {
    missing.push('task');
  }
  if (!isValidCreateHours(slots.hours)) {
    missing.push('hours');
  }
  return missing;
}

export function isValidCreateHours(
  hours: number | null | undefined
): boolean {
  return (
    typeof hours === 'number' &&
    Number.isFinite(hours) &&
    hours > 0 &&
    hours <= 24
  );
}

/** True when create Draft may authorize prepare_create_timesheet_entry. */
export function assertCanonicalCreateReady(slots: {
  resolvedDate?: string | null;
  date?: string | null;
  hours?: number | null;
  resolvedProjectId?: string | null;
  resolvedTaskId?: string | null;
}): { ok: true } | { ok: false; missingFields: IntentMissingField[] } {
  const missing = computeCanonicalCreateMissingFields(slots);
  return missing.length === 0 ? { ok: true } : { ok: false, missingFields: missing };
}

/**
 * Normalize stored Draft missingFields from canonical slot state.
 * Preserves hints; never invents IDs. Create intents only.
 */
export function normalizeIntentDraft(draft: IntentDraft): IntentDraft {
  if (draft.intent !== 'create_timesheet_entry') return draft;
  const missing = computeCanonicalCreateMissingFields({
    resolvedDate: draft.resolvedDate,
    hours: draft.hours,
    resolvedProjectId: draft.resolvedProjectId,
    resolvedTaskId: draft.resolvedTaskId,
  });
  if (
    missing.length === draft.missingFields.length &&
    missing.every((f, i) => f === draft.missingFields[i])
  ) {
    return draft;
  }
  return { ...draft, missingFields: missing };
}

/** @deprecated Length-based Task/Project fallback removed — use evaluateTargetAnswer. */
export function structuralFillForOutstandingSlot(): undefined {
  return undefined;
}

/** @deprecated Use evaluateTargetAnswer. */
export async function matchOutstandingSlot(): Promise<undefined> {
  return undefined;
}

/** @deprecated Use MissingFieldFill via TargetResolution. */
export type MissingFieldFill =
  | { matchedField: 'date'; dateExpression: string }
  | { matchedField: 'project'; projectHint: string }
  | { matchedField: 'task'; taskHint: string }
  | { matchedField: 'hours'; hours: number };

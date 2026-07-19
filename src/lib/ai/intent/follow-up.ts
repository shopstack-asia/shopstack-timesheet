/**
 * Deterministic follow-up / draft-continuation helpers.
 * AI may propose refersToPrevious; enforcement validates before merging.
 */

import {
  parseHoursValue,
  resolveDateExpression,
} from '@/lib/ai/intent/date-resolve';
import type {
  IntentDraft,
  IntentMissingField,
  StructuredIntent,
} from '@/lib/ai/intent/types';
import {
  resolveProject,
  resolveTask,
} from '@/lib/timesheet/write/master-resolve';

const EXPLICIT_DRAFT_CANCEL_RE =
  /^(ยกเลิกคำขอนี้|ไม่ลงเวลาแล้ว|cancel this draft|cancel the draft|ล้างคำขอ|ไม่ทำต่อแล้ว)[\s!.?]*$/i;

const EXPLICIT_CONTINUE_RE =
  /(ต่อจากเมื่อกี้|ตามที่ขอ|ตามที่ค้าง|continue (the )?draft|same (request|timesheet)|เพิ่มเติมตามเดิม)/i;

/** Phrases that must never fill Project/Task/date/hours slots. */
const UNRELATED_GENERAL_RE =
  /^(ขอบคุณ|ขอบใจ|โอเค|ok|okay|สวัสดี|hello|hi|hey|เล่าเรื่อง|what is|what's|explain|ช่วยเขียน|อากาศ|weather|how are you|ดีจ้า|ครับ|ค่ะ)([\s!.?].*)?$/i;

const WRITE_INTENTS = new Set([
  'create_timesheet_entry',
  'update_timesheet_entry',
  'delete_timesheet_entry',
]);

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
  if (/เล่าเรื่องแมว|ช่วยเขียน\s*typescript|what is a timesheet|what is project management/i.test(t)) {
    return true;
  }
  return false;
}

export type MissingFieldFill = {
  dateExpression?: string;
  projectHint?: string;
  taskHint?: string;
  hours?: number;
  matchedField: IntentMissingField;
};

export type MergeDecision =
  | { merge: false; reason: string }
  | { merge: true; reason: string; fill?: MissingFieldFill };

/**
 * Decide whether to continue an incomplete Intent Draft with this message.
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

  if (intent.intent === 'general_conversation' && !intent.refersToPrevious) {
    return { merge: false, reason: 'general_conversation' };
  }

  if (isUnrelatedGeneralPhrase(trimmed) && !intent.refersToPrevious) {
    return { merge: false, reason: 'unrelated_general_phrase' };
  }

  // Silent intent change (create → update) is not allowed
  if (
    WRITE_INTENTS.has(intent.intent) &&
    WRITE_INTENTS.has(draft.intent) &&
    intent.intent !== draft.intent &&
    !intent.refersToPrevious
  ) {
    return { merge: false, reason: 'intent_mismatch' };
  }

  if (intent.refersToPrevious === true) {
    return { merge: true, reason: 'refers_to_previous' };
  }

  if (isExplicitDraftContinuePhrase(trimmed)) {
    return { merge: true, reason: 'explicit_continue' };
  }

  // Same write intent from extractor with overlapping hints → continue
  if (
    WRITE_INTENTS.has(intent.intent) &&
    intent.intent === draft.intent &&
    (intent.dateExpression ||
      intent.projectHint ||
      intent.taskHint ||
      intent.hours != null)
  ) {
    return { merge: true, reason: 'same_write_intent_with_slots' };
  }

  const fill = await matchMissingFieldDeterministically({
    draft,
    userMessage: trimmed,
    now,
    resolveProjectFn: input.resolveProjectFn,
    resolveTaskFn: input.resolveTaskFn,
  });
  if (fill) {
    return { merge: true, reason: 'deterministic_missing_field', fill };
  }

  return { merge: false, reason: 'no_merge_signal' };
}

/**
 * Match the whole message to exactly one missing draft field.
 */
export async function matchMissingFieldDeterministically(input: {
  draft: IntentDraft;
  userMessage: string;
  now: Date;
  resolveProjectFn?: typeof resolveProject;
  resolveTaskFn?: typeof resolveTask;
}): Promise<MissingFieldFill | undefined> {
  const { draft, userMessage, now } = input;
  const missing = draft.missingFields;
  if (missing.length === 0) return undefined;
  if (isUnrelatedGeneralPhrase(userMessage)) return undefined;

  const resolveProj = input.resolveProjectFn ?? resolveProject;
  const resolveTk = input.resolveTaskFn ?? resolveTask;

  if (missing.includes('hours')) {
    const hours = parseHoursValue(undefined, userMessage);
    if (hours !== undefined) {
      return { hours, matchedField: 'hours' };
    }
  }

  if (missing.includes('date')) {
    const date = resolveDateExpression(userMessage, now);
    if (date) {
      return { dateExpression: userMessage.trim(), matchedField: 'date' };
    }
  }

  // Only treat as project/task fill when that field is missing and message is a short hint
  const hint = userMessage.trim();
  if (hint.length > 48) return undefined;

  if (missing.includes('task') && !missing.includes('project')) {
    try {
      const task = await resolveTk({ taskName: hint });
      if (task.status === 'resolved') {
        return { taskHint: hint, matchedField: 'task' };
      }
    } catch {
      /* ignore — not a deterministic match */
    }
  }

  if (missing.includes('project') && !missing.includes('task')) {
    try {
      const proj = await resolveProj({ projectName: hint });
      if (proj.status === 'resolved') {
        return { projectHint: hint, matchedField: 'project' };
      }
    } catch {
      /* ignore */
    }
  }

  // Both project and task missing: only fill if uniquely resolves as one of them
  if (missing.includes('task')) {
    try {
      const task = await resolveTk({ taskName: hint });
      if (task.status === 'resolved') {
        return { taskHint: hint, matchedField: 'task' };
      }
    } catch {
      /* ignore */
    }
  }
  if (missing.includes('project')) {
    try {
      const proj = await resolveProj({ projectName: hint });
      if (proj.status === 'resolved') {
        return { projectHint: hint, matchedField: 'project' };
      }
    } catch {
      /* ignore */
    }
  }

  return undefined;
}

/**
 * Merge draft slots into the AI proposal. Preserves draft intent and resolved fields.
 */
export function applyDraftMerge(
  intent: StructuredIntent,
  draft: IntentDraft,
  fill?: MissingFieldFill
): StructuredIntent {
  return {
    ...intent,
    domain: 'timesheet',
    intent: draft.intent,
    dateExpression:
      intent.dateExpression ||
      fill?.dateExpression ||
      draft.dateExpression ||
      draft.resolvedDate ||
      null,
    projectHint:
      intent.projectHint || fill?.projectHint || draft.projectHint || null,
    taskHint: intent.taskHint || fill?.taskHint || draft.taskHint || null,
    hours: intent.hours ?? fill?.hours ?? draft.hours ?? null,
    refersToPrevious: true,
    // missingFields recomputed later by enforcement — ignore model list
    missingFields: [],
    ambiguities: intent.ambiguities ?? [],
  };
}

export function recomputeCreateMissingFields(slots: {
  date?: string;
  hours?: number;
  projectHint?: string;
  resolvedProjectId?: string;
  taskHint?: string;
  resolvedTaskId?: string;
}): IntentMissingField[] {
  const missing: IntentMissingField[] = [];
  if (!slots.date) missing.push('date');
  if (!slots.projectHint && !slots.resolvedProjectId) missing.push('project');
  if (!slots.taskHint && !slots.resolvedTaskId) missing.push('task');
  if (slots.hours === undefined) missing.push('hours');
  return missing;
}

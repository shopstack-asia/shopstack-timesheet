/**
 * Deterministic enforcement: StructuredIntent → BusinessToolDecision.
 * AI output is a proposal only — this layer authorizes tools and arguments.
 */

import type { BusinessToolDecision } from '@/lib/ai/decision-engine';
import {
  parseHoursValue,
  resolveDateExpression,
  resolveRangeExpressions,
  isValidIsoDate,
} from '@/lib/ai/intent/date-resolve';
import {
  buildDraftFromSlots,
  draftSummary,
  type DraftWriteResult,
  type IntentDraftStore,
} from '@/lib/ai/intent/draft-store';
import {
  applyDraftMerge,
  decideDraftMerge,
  isExplicitDraftCancelPhrase,
  isUnrelatedGeneralPhrase,
  normalizeAnswerKey,
  recomputeCreateMissingFields,
} from '@/lib/ai/intent/follow-up';
import { enrichWriteIntentSlots } from '@/lib/ai/intent/slot-enrich';
import type {
  IntentDraft,
  IntentMissingField,
  StructuredIntent,
} from '@/lib/ai/intent/types';
import {
  formatProjectLabel,
  formatTaskLabel,
  resolveProject,
  resolveTask,
} from '@/lib/timesheet/write/master-resolve';
import type { PendingSummary } from '@/lib/ai/write-decision';
import {
  resolveConfirmOrCancel,
  isBareConfirmPhrase,
  isBareCancelPhrase,
} from '@/lib/ai/write-decision';
import { getCachedTasks, getCachedProjects } from '@/lib/google-sheets';

export const DRAFT_STORE_UNAVAILABLE_CLARIFY =
  'ระบบยังเก็บคำขอต่อเนื่องไม่ได้ชั่วคราว กรุณาระบุวันที่ Project งาน และจำนวนชั่วโมงในข้อความเดียวครับ';

export const DRAFT_FOLLOWUP_UNAVAILABLE_CLARIFY =
  'ระบบยังโหลดคำขอค้างไว้ไม่ได้ชั่วคราว กรุณาส่งรายละเอียด Timesheet ครบในข้อความเดียวครับ (วันที่ Project งาน และจำนวนชั่วโมง)';

export const DRAFT_CANCELLED_MESSAGE =
  'ยกเลิกคำขอแล้วครับ ยังไม่มีการเตรียมรายการ Timesheet';

function logEnforce(payload: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      scope: 'ai-intent-enforce',
      level: 'info',
      ts: new Date().toISOString(),
      ...payload,
    })
  );
}

export type EnforceIntentOptions = {
  now?: Date;
  pendingChanges?: PendingSummary[];
  draft?: IntentDraft | null;
  /** True when a draft was needed but Redis could not load it. */
  draftLoadFailed?: boolean;
  draftStore?: IntentDraftStore;
  conversationId?: string;
  slackUserId?: string;
  resolveProjectFn?: typeof resolveProject;
  resolveTaskFn?: typeof resolveTask;
  userMessage?: string;
};

export type EnforceIntentResult = {
  decision: BusinessToolDecision;
  draftOutcome?: string;
  draftStoreAvailable?: boolean;
};

function clarifyMissing(fields: IntentMissingField[]): string {
  const set = new Set(fields);
  if (set.has('date') && set.has('project') && set.has('task') && set.has('hours')) {
    return 'ข้อมูล Timesheet ยังไม่ครบ กรุณาระบุวันที่ Project งาน และจำนวนชั่วโมงครับ';
  }
  if (set.has('task') && set.has('hours') && !set.has('project') && !set.has('date')) {
    return 'ต้องการลง Task อะไร และกี่ชั่วโมงครับ เช่น Development หรือ Project Management';
  }
  if (set.has('date') && (set.has('project') || set.has('task'))) {
    return 'ต้องการลงวันที่ไหน และให้ Project/งานอะไรครับ';
  }
  if (set.has('date')) return 'ต้องการลงวันที่ไหนครับ';
  if (set.has('project') && set.has('task')) {
    return 'ต้องการลงเวลาให้ Project และ Task อะไรครับ';
  }
  if (set.has('project')) return 'ต้องการลงเวลาให้โปรเจกต์ไหนครับ';
  if (set.has('task')) {
    return 'ทำ Task อะไรครับ เช่น Development หรือ Project Management';
  }
  if (set.has('hours')) return 'ต้องการลงกี่ชั่วโมงครับ';
  if (set.has('matchEntry')) {
    return 'ต้องการแก้รายการวันที่ไหน และเปลี่ยนเป็นกี่ชั่วโมงครับ';
  }
  return 'ข้อมูล Timesheet ยังไม่ครบ กรุณาระบุรายละเอียดเพิ่มเติมครับ';
}

function primaryMissingField(
  fields: IntentMissingField[]
): IntentMissingField | undefined {
  const order: IntentMissingField[] = ['date', 'project', 'task', 'hours'];
  return order.find((f) => fields.includes(f));
}

async function listTaskCandidatesMessage(hint: string): Promise<string> {
  try {
    const tasks = await getCachedTasks();
    const list = tasks
      .slice(0, 8)
      .map((t) => `• ${formatTaskLabel(t)}`)
      .join('\n');
    if (list) {
      return `ยังไม่พบ Task ชื่อ ${hint} ครับ Task ที่เลือกได้มี:\n${list}`;
    }
  } catch {
    /* fall through */
  }
  return `ยังไม่พบ Task ชื่อ “${hint}” ครับ ลองระบุชื่องานตามรายการในระบบอีกครั้ง`;
}

async function listProjectCandidatesMessage(hint: string): Promise<string> {
  try {
    const projects = await getCachedProjects();
    const list = projects
      .slice(0, 8)
      .map((p) => `• ${formatProjectLabel(p)}`)
      .join('\n');
    if (list) {
      return `ยังไม่พบ Project ที่ตรงกับ ${hint} ครับ ตัวอย่างที่เลือกได้:\n${list}`;
    }
  } catch {
    /* fall through */
  }
  return `ยังไม่พบ Project ที่ตรงกับ “${hint}” ครับ ลองระบุชื่อหรือรหัส Project อีกครั้ง`;
}

async function persistDraft(
  opts: EnforceIntentOptions,
  slots: Omit<
    Parameters<typeof buildDraftFromSlots>[0],
    'conversationId' | 'slackUserId' | 'now'
  >
): Promise<DraftWriteResult> {
  if (!opts.draftStore || !opts.conversationId || !opts.slackUserId) {
    return { outcome: 'draft_store_unavailable' };
  }
  return opts.draftStore.set(
    buildDraftFromSlots({
      ...slots,
      conversationId: opts.conversationId,
      slackUserId: opts.slackUserId,
      now: opts.now,
    })
  );
}

async function clearDraft(
  opts: EnforceIntentOptions
): Promise<DraftWriteResult | undefined> {
  if (!opts.draftStore || !opts.conversationId || !opts.slackUserId) {
    return undefined;
  }
  return opts.draftStore.clear(opts.conversationId, opts.slackUserId);
}

function incompleteNeedsDraftMessage(
  saveResult: DraftWriteResult
): BusinessToolDecision | null {
  if (saveResult.outcome === 'draft_store_unavailable') {
    return {
      action: 'clarify',
      message: DRAFT_STORE_UNAVAILABLE_CLARIFY,
      reason: 'draft_store_unavailable',
    };
  }
  return null;
}

/**
 * Map validated structured intent to a BusinessToolDecision.
 */
export async function enforceStructuredIntent(
  rawIntent: StructuredIntent,
  options: EnforceIntentOptions = {}
): Promise<BusinessToolDecision> {
  const result = await enforceStructuredIntentDetailed(rawIntent, options);
  return result.decision;
}

export async function enforceStructuredIntentDetailed(
  rawIntent: StructuredIntent,
  options: EnforceIntentOptions = {}
): Promise<EnforceIntentResult> {
  const now = options.now ?? new Date();
  const pending = options.pendingChanges ?? [];
  const userMessage = options.userMessage || '';

  // Explicit draft cancellation (not bare ยกเลิก — that is handled in decide)
  if (isExplicitDraftCancelPhrase(userMessage)) {
    const cleared = await clearDraft(options);
    return {
      decision: {
        action: 'clarify',
        message: DRAFT_CANCELLED_MESSAGE,
        reason: 'intent_draft_cancelled',
      },
      draftOutcome: cleared?.outcome ?? 'draft_cleared',
      draftStoreAvailable: cleared?.outcome !== 'draft_store_unavailable',
    };
  }

  // Deterministic bare confirm always wins for pending confirmations
  if (isBareConfirmPhrase(userMessage)) {
    const cc = resolveConfirmOrCancel(userMessage, pending);
    if (cc) {
      await clearDraft(options);
      return { decision: cc, draftStoreAvailable: true };
    }
  }

  if (isBareCancelPhrase(userMessage)) {
    const cc = resolveConfirmOrCancel(userMessage, pending);
    if (cc && (cc.action === 'call_tool' || pending.length > 0)) {
      await clearDraft(options);
      return { decision: cc, draftStoreAvailable: true };
    }
    // Bare cancel with no pending: clear Intent Draft if present
    if (options.draft) {
      const cleared = await clearDraft(options);
      return {
        decision: {
          action: 'clarify',
          message: DRAFT_CANCELLED_MESSAGE,
          reason: 'intent_draft_cancelled',
        },
        draftOutcome: cleared?.outcome ?? 'draft_cleared',
      };
    }
    if (cc) {
      return { decision: cc };
    }
  }

  // Follow-up needed but draft store could not load — do not guess context.
  // Complete new requests may continue without a draft.
  if (
    options.draftLoadFailed &&
    !options.draft &&
    (rawIntent.refersToPrevious === true ||
      looksLikeShortFollowUp(userMessage))
  ) {
    return {
      decision: {
        action: 'clarify',
        message: DRAFT_FOLLOWUP_UNAVAILABLE_CLARIFY,
        reason: 'draft_store_unavailable',
      },
      draftStoreAvailable: false,
      draftOutcome: 'draft_store_unavailable',
    };
  }

  let intent = enrichWriteIntentSlots(rawIntent, userMessage, now);
  let draftOutcome: string | undefined;
  let mergeReason: string | undefined;

  if (options.draft) {
    const merge = await decideDraftMerge({
      intent,
      draft: options.draft,
      userMessage,
      now,
      resolveProjectFn: options.resolveProjectFn,
      resolveTaskFn: options.resolveTaskFn,
    });
    mergeReason = merge.reason;

    if (merge.merge) {
      intent = enrichWriteIntentSlots(
        applyDraftMerge(intent, options.draft, merge.fill),
        userMessage,
        now
      );
    } else if (
      intent.intent === 'general_conversation' ||
      isUnrelatedGeneralPhrase(userMessage) ||
      merge.reason === 'unrelated_general_phrase' ||
      merge.reason === 'general_conversation'
    ) {
      // Preserve incomplete draft — do not clear, do not mutate
      return {
        decision: { action: 'none', reason: 'general_conversation' },
        draftOutcome: 'draft_preserved',
        draftStoreAvailable: true,
      };
    } else if (
      intent.intent === 'unknown' &&
      !looksLikeBusinessTimesheetText(userMessage)
    ) {
      return {
        decision: { action: 'none', reason: 'unknown_intent' },
        draftOutcome: 'draft_preserved',
      };
    }
    // else: new timesheet intent may replace draft via normal create path
  }

  logEnforce({
    message: 'intent_enforcement',
    requestId: undefined,
    conversationId: options.conversationId,
    intent: intent.intent,
    draftFound: Boolean(options.draft),
    draftMergeReason: mergeReason,
    missingFields: intent.missingFields,
  });

  switch (intent.intent) {
    case 'general_conversation':
      // Do not clear an unrelated draft when user chats generally without merge
      return {
        decision: { action: 'none', reason: 'general_conversation' },
        draftOutcome: options.draft ? 'draft_preserved' : undefined,
      };

    case 'unknown':
      if (intent.domain === 'timesheet' || options.draft) {
        return {
          decision: {
            action: 'clarify',
            message:
              'ต้องการทำรายการ Timesheet แบบไหนครับ (ลงเวลา / แก้ / ลบ / ดูข้อมูล)',
            reason: 'unknown_business_intent',
          },
          draftOutcome: options.draft ? 'draft_preserved' : undefined,
        };
      }
      return { decision: { action: 'none', reason: 'unknown_intent' } };

    case 'get_my_profile':
      await clearDraft(options);
      return {
        decision: {
          action: 'call_tool',
          toolName: 'get_my_profile',
          arguments: {},
          reason: 'ai_intent_get_my_profile',
        },
      };

    case 'get_work_context':
      await clearDraft(options);
      return {
        decision: {
          action: 'call_tool',
          toolName: 'get_work_context',
          arguments: {},
          reason: 'ai_intent_get_work_context',
        },
      };

    case 'get_timesheet_day': {
      await clearDraft(options);
      const date =
        resolveDateExpression(intent.dateExpression, now) ||
        options.draft?.resolvedDate;
      if (!date || !isValidIsoDate(date)) {
        return {
          decision: {
            action: 'clarify',
            message: 'Which date or date range do you mean?',
            reason: 'missing_timesheet_period',
          },
        };
      }
      return {
        decision: {
          action: 'call_tool',
          toolName: 'get_timesheet',
          arguments: { date },
          reason: 'ai_intent_get_timesheet_day',
        },
      };
    }

    case 'get_timesheet_range': {
      await clearDraft(options);
      const range = resolveRangeExpressions(
        intent.startDateExpression || intent.dateExpression,
        intent.endDateExpression,
        now
      );
      if (!range) {
        return {
          decision: {
            action: 'clarify',
            message: 'Which date or date range do you mean?',
            reason: 'missing_timesheet_period',
          },
        };
      }
      return {
        decision: {
          action: 'call_tool',
          toolName: 'get_timesheet_range',
          arguments: range,
          reason: 'ai_intent_get_timesheet_range',
        },
      };
    }

    case 'confirm_timesheet_change': {
      await clearDraft(options);
      const cc = resolveConfirmOrCancel('ยืนยัน', pending);
      if (cc) return { decision: cc };
      return {
        decision: {
          action: 'clarify',
          message:
            'ยืนยันอะไรครับ ตอนนี้ไม่มีรายการ Timesheet ที่รอการยืนยัน',
          reason: 'confirm_without_pending',
        },
      };
    }

    case 'cancel_timesheet_change': {
      await clearDraft(options);
      const cc = resolveConfirmOrCancel('ยกเลิก', pending);
      if (cc) return { decision: cc };
      return {
        decision: {
          action: 'clarify',
          message: 'ตอนนี้ไม่มีรายการ Timesheet ที่รอการยืนยันครับ',
          reason: 'cancel_without_pending',
        },
      };
    }

    case 'submit_timesheet': {
      await clearDraft(options);
      const week = resolveRangeExpressions('สัปดาห์นี้', null, now);
      return {
        decision: {
          action: 'call_tool',
          toolName: 'prepare_submit_timesheet',
          arguments: { weekStart: week?.startDate },
          reason: 'ai_intent_submit_timesheet',
        },
      };
    }

    case 'create_timesheet_entry': {
      const created = await enforceCreate(intent, options, now);
      return { ...created, draftOutcome: created.draftOutcome ?? draftOutcome };
    }

    case 'update_timesheet_entry': {
      const updated = await enforceUpdate(intent, options, now);
      return { ...updated, draftOutcome: updated.draftOutcome ?? draftOutcome };
    }

    case 'delete_timesheet_entry': {
      const deleted = await enforceDelete(intent, options, now);
      return { ...deleted, draftOutcome: deleted.draftOutcome ?? draftOutcome };
    }

    default:
      return {
        decision: {
          action: 'clarify',
          message:
            'ต้องการทำรายการ Timesheet แบบไหนครับ (ลงเวลา / แก้ / ลบ / ดูข้อมูล)',
          reason: 'unknown_business_intent',
        },
      };
  }
}

async function enforceCreate(
  intent: StructuredIntent,
  options: EnforceIntentOptions,
  now: Date
): Promise<EnforceIntentResult> {
  const resolveProj = options.resolveProjectFn ?? resolveProject;
  const resolveTk = options.resolveTaskFn ?? resolveTask;
  const draft = options.draft;
  const answerNorm = normalizeAnswerKey(options.userMessage || '');

  const date =
    resolveDateExpression(intent.dateExpression, now) || draft?.resolvedDate;

  const hours = parseHoursValue(intent.hours, options.userMessage);

  let projectHint = intent.projectHint?.trim() || draft?.projectHint || '';
  let taskHint = intent.taskHint?.trim() || draft?.taskHint || '';

  let resolvedProjectId =
    draft?.resolvedProjectId &&
    (!intent.projectHint ||
      normalizeAnswerKey(intent.projectHint) ===
        normalizeAnswerKey(draft.projectHint || ''))
      ? draft.resolvedProjectId
      : undefined;
  let resolvedTaskId =
    draft?.resolvedTaskId &&
    (!intent.taskHint ||
      normalizeAnswerKey(intent.taskHint) ===
        normalizeAnswerKey(draft.taskHint || ''))
      ? draft.resolvedTaskId
      : undefined;

  // Clear resolved IDs when the corresponding hint changed
  if (
    draft?.projectHint &&
    projectHint &&
    normalizeAnswerKey(projectHint) !== normalizeAnswerKey(draft.projectHint)
  ) {
    resolvedProjectId = undefined;
  }
  if (
    draft?.taskHint &&
    taskHint &&
    normalizeAnswerKey(taskHint) !== normalizeAnswerKey(draft.taskHint)
  ) {
    resolvedTaskId = undefined;
  }

  const missingBeforeResolve = recomputeCreateMissingFields({
    date,
    hours,
    projectHint,
    resolvedProjectId,
    taskHint,
    resolvedTaskId,
  });

  if (missingBeforeResolve.length > 0) {
    const field = primaryMissingField(missingBeforeResolve) || 'task';
    const prevCount = draft?.clarificationCount ?? 0;
    const sameField = draft?.lastClarificationField === field;
    const sameAnswer =
      Boolean(draft?.lastUserAnswerNorm) &&
      draft?.lastUserAnswerNorm === answerNorm &&
      sameField;
    const clarificationCount = sameField ? prevCount + 1 : 1;

    let message = clarifyMissing(missingBeforeResolve);
    if (sameAnswer && clarificationCount >= 2) {
      if (field === 'task') {
        message = await listTaskCandidatesMessage(taskHint || answerNorm || 'Task');
      } else if (field === 'project') {
        message = await listProjectCandidatesMessage(
          projectHint || answerNorm || 'Project'
        );
      }
    }

    const saved = await persistDraft(options, {
      intent: 'create_timesheet_entry',
      dateExpression: intent.dateExpression || undefined,
      resolvedDate: date,
      projectHint: projectHint || undefined,
      resolvedProjectId,
      taskHint: taskHint || undefined,
      resolvedTaskId,
      hours,
      missingFields: missingBeforeResolve,
      lastClarificationField: field,
      lastClarificationReason: 'missing_fields',
      clarificationCount,
      lastUserAnswerNorm: answerNorm || undefined,
      lastResolutionOutcome: 'missing',
      previous: draft || undefined,
    });
    const fail = incompleteNeedsDraftMessage(saved);
    if (fail) {
      return {
        decision: fail,
        draftOutcome: saved.outcome,
        draftStoreAvailable: false,
      };
    }
    logEnforce({
      message: 'clarification_required',
      conversationId: options.conversationId,
      intent: 'create_timesheet_entry',
      filledFields: {
        date: Boolean(date),
        project: Boolean(projectHint || resolvedProjectId),
        task: Boolean(taskHint || resolvedTaskId),
        hours: hours !== undefined,
      },
      missingFields: missingBeforeResolve,
      clarificationField: field,
      clarificationCount,
      projectResolutionOutcome: 'not_called',
      taskResolutionOutcome: 'not_called',
    });
    return {
      decision: {
        action: 'clarify',
        message,
        reason: 'task_missing',
      },
      draftOutcome: saved.outcome,
      draftStoreAvailable: true,
    };
  }

  let projectOutcome = 'not_called';
  let taskOutcome = 'not_called';

  if (!resolvedProjectId && projectHint) {
    let proj: Awaited<ReturnType<typeof resolveProj>>;
    try {
      proj = await resolveProj({ projectName: projectHint });
    } catch {
      return {
        decision: {
          action: 'clarify',
          message:
            'ยังไม่สามารถค้นหา Project ได้ในขณะนี้ครับ กรุณาลองใหม่อีกครั้ง',
          reason: 'read_failed',
        },
      };
    }
    projectOutcome = proj.status;
    if (proj.status === 'not_found') {
      const count = (draft?.clarificationCount ?? 0) + 1;
      const message =
        count >= 2
          ? await listProjectCandidatesMessage(projectHint)
          : `ยังไม่พบ Project ที่ตรงกับ “${projectHint}” ครับ ลองระบุชื่อหรือรหัส Project อีกครั้ง`;
      await persistDraft(options, {
        intent: 'create_timesheet_entry',
        resolvedDate: date,
        projectHint,
        taskHint: taskHint || undefined,
        resolvedTaskId,
        hours,
        missingFields: ['project'],
        lastClarificationField: 'project',
        lastClarificationReason: 'project_not_found',
        clarificationCount: count,
        lastUserAnswerNorm: answerNorm,
        lastResolutionOutcome: 'not_found',
        previous: draft || undefined,
      });
      return {
        decision: {
          action: 'clarify',
          message,
          reason: 'project_not_found',
        },
      };
    }
    if (proj.status === 'ambiguous') {
      const list = proj.candidates
        .slice(0, 5)
        .map((p) => `• ${formatProjectLabel(p)}`)
        .join('\n');
      await persistDraft(options, {
        intent: 'create_timesheet_entry',
        resolvedDate: date,
        projectHint,
        taskHint: taskHint || undefined,
        resolvedTaskId,
        hours,
        missingFields: ['project'],
        ambiguities: proj.candidates.map((p) => p.ProjectID),
        lastClarificationField: 'project',
        lastClarificationReason: 'project_ambiguous',
        clarificationCount: (draft?.clarificationCount ?? 0) + 1,
        lastUserAnswerNorm: answerNorm,
        lastResolutionOutcome: 'ambiguous',
        previous: draft || undefined,
      });
      return {
        decision: {
          action: 'clarify',
          message: `พบหลายโปรเจกต์ที่ตรงกับ ${projectHint} กรุณาเลือก:\n${list}`,
          reason: 'project_ambiguous',
        },
      };
    }
    resolvedProjectId = proj.value.ProjectID;
  }

  if (!resolvedTaskId && taskHint) {
    let task: Awaited<ReturnType<typeof resolveTk>>;
    try {
      task = await resolveTk({ taskName: taskHint });
    } catch {
      return {
        decision: {
          action: 'clarify',
          message:
            'ยังไม่สามารถค้นหางานได้ในขณะนี้ครับ กรุณาลองใหม่อีกครั้ง',
          reason: 'read_failed',
        },
      };
    }
    taskOutcome = task.status;
    if (task.status === 'not_found') {
      const count = (draft?.clarificationCount ?? 0) + 1;
      const message = await listTaskCandidatesMessage(taskHint);
      await persistDraft(options, {
        intent: 'create_timesheet_entry',
        resolvedDate: date,
        projectHint: projectHint || undefined,
        resolvedProjectId,
        taskHint,
        hours,
        missingFields: ['task'],
        lastClarificationField: 'task',
        lastClarificationReason: 'task_not_found',
        clarificationCount: count,
        lastUserAnswerNorm: answerNorm,
        lastResolutionOutcome: 'not_found',
        previous: draft || undefined,
      });
      return {
        decision: {
          action: 'clarify',
          message,
          reason: 'task_not_found',
        },
      };
    }
    if (task.status === 'ambiguous') {
      const list = task.candidates
        .slice(0, 5)
        .map((t) => `• ${formatTaskLabel(t)}`)
        .join('\n');
      await persistDraft(options, {
        intent: 'create_timesheet_entry',
        resolvedDate: date,
        projectHint: projectHint || undefined,
        resolvedProjectId,
        taskHint,
        hours,
        missingFields: ['task'],
        ambiguities: task.candidates.map((t) => t.TaskID),
        lastClarificationField: 'task',
        lastClarificationReason: 'task_ambiguous',
        clarificationCount: (draft?.clarificationCount ?? 0) + 1,
        lastUserAnswerNorm: answerNorm,
        lastResolutionOutcome: 'ambiguous',
        previous: draft || undefined,
      });
      return {
        decision: {
          action: 'clarify',
          message: `พบหลาย Task ที่ตรงกับ ${taskHint} กรุณาเลือก:\n${list}`,
          reason: 'task_ambiguous',
        },
      };
    }
    resolvedTaskId = task.value.TaskID;
  }

  if (!date || hours === undefined || !resolvedProjectId || !resolvedTaskId) {
    return {
      decision: {
        action: 'clarify',
        message: clarifyMissing(
          recomputeCreateMissingFields({
            date,
            hours,
            projectHint,
            resolvedProjectId,
            taskHint,
            resolvedTaskId,
          })
        ),
        reason: 'validation_failed',
      },
    };
  }

  await clearDraft(options);
  logEnforce({
    message: 'business_tool_selected',
    conversationId: options.conversationId,
    intent: 'create_timesheet_entry',
    selectedTool: 'prepare_create_timesheet_entry',
    projectResolutionOutcome: projectOutcome,
    taskResolutionOutcome: taskOutcome,
    missingFields: [],
  });
  return {
    decision: {
      action: 'call_tool',
      toolName: 'prepare_create_timesheet_entry',
      arguments: {
        date,
        hours,
        projectId: resolvedProjectId,
        taskId: resolvedTaskId,
        ...(projectHint ? { projectName: projectHint } : {}),
        ...(taskHint ? { taskName: taskHint } : {}),
      },
      reason: 'ai_intent_create_entry',
    },
    draftOutcome: 'draft_cleared',
  };
}

async function enforceUpdate(
  intent: StructuredIntent,
  options: EnforceIntentOptions,
  now: Date
): Promise<EnforceIntentResult> {
  const missing: IntentMissingField[] = [];
  const date =
    resolveDateExpression(intent.dateExpression, now) ||
    options.draft?.resolvedDate;
  const hours = parseHoursValue(intent.hours, options.userMessage);
  const projectHint =
    intent.projectHint?.trim() || options.draft?.projectHint || '';

  if (!date) missing.push('date');
  if (!projectHint) missing.push('project');
  if (hours === undefined) missing.push('hours');

  if (missing.length > 0) {
    const saved = await persistDraft(options, {
      intent: 'update_timesheet_entry',
      dateExpression: intent.dateExpression || undefined,
      resolvedDate: date,
      projectHint: projectHint || undefined,
      hours,
      missingFields: missing.length ? missing : ['matchEntry'],
    });
    const fail = incompleteNeedsDraftMessage(saved);
    if (fail) {
      return {
        decision: fail,
        draftOutcome: saved.outcome,
        draftStoreAvailable: false,
      };
    }
    return {
      decision: {
        action: 'clarify',
        message:
          missing.length > 0
            ? clarifyMissing(
                missing.includes('hours') && missing.includes('date')
                  ? ['matchEntry']
                  : missing
              )
            : 'ต้องการแก้รายการวันที่ไหน และเปลี่ยนเป็นกี่ชั่วโมงครับ',
        reason: 'ai_intent_update_missing_fields',
      },
      draftOutcome: saved.outcome,
    };
  }

  await clearDraft(options);
  return {
    decision: {
      action: 'call_tool',
      toolName: 'prepare_update_timesheet_entry',
      arguments: {
        date,
        matchProjectName: projectHint,
        hours,
      },
      reason: 'ai_intent_update_entry',
    },
    draftOutcome: 'draft_cleared',
  };
}

async function enforceDelete(
  intent: StructuredIntent,
  options: EnforceIntentOptions,
  now: Date
): Promise<EnforceIntentResult> {
  const missing: IntentMissingField[] = [];
  const date =
    resolveDateExpression(intent.dateExpression, now) ||
    options.draft?.resolvedDate;
  const projectHint =
    intent.projectHint?.trim() || options.draft?.projectHint || '';

  if (!date) missing.push('date');
  if (!projectHint) missing.push('project');

  if (missing.length > 0) {
    const saved = await persistDraft(options, {
      intent: 'delete_timesheet_entry',
      dateExpression: intent.dateExpression || undefined,
      resolvedDate: date,
      projectHint: projectHint || undefined,
      missingFields: missing,
    });
    const fail = incompleteNeedsDraftMessage(saved);
    if (fail) {
      return {
        decision: fail,
        draftOutcome: saved.outcome,
        draftStoreAvailable: false,
      };
    }
    return {
      decision: {
        action: 'clarify',
        message: clarifyMissing(missing),
        reason: 'ai_intent_delete_missing_fields',
      },
      draftOutcome: saved.outcome,
    };
  }

  await clearDraft(options);
  return {
    decision: {
      action: 'call_tool',
      toolName: 'prepare_delete_timesheet_entry',
      arguments: {
        date,
        matchProjectName: projectHint,
      },
      reason: 'ai_intent_delete_entry',
    },
    draftOutcome: 'draft_cleared',
  };
}

function looksLikeShortFollowUp(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 24 && !isUnrelatedGeneralPhrase(t);
}

export function looksLikeBusinessTimesheetText(text: string): boolean {
  return /(ลงเวลา|บันทึกเวลา|timesheet|ชั่วโมง|ชม\.?|hours?|hrs?|project|โปรเจกต์|งาน\s|rms|\blog\s+\d|add\s+.*hour|แก้เวลา|ลบรายการ|submit|ลงเวลางาน)/i.test(
    text
  );
}

export { draftSummary };

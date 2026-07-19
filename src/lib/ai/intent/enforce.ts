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
  recomputeCreateMissingFields,
} from '@/lib/ai/intent/follow-up';
import type {
  IntentDraft,
  IntentMissingField,
  StructuredIntent,
} from '@/lib/ai/intent/types';
import {
  formatProjectLabel,
  resolveProject,
  resolveTask,
} from '@/lib/timesheet/write/master-resolve';
import type { PendingSummary } from '@/lib/ai/write-decision';
import {
  resolveConfirmOrCancel,
  isBareConfirmPhrase,
  isBareCancelPhrase,
} from '@/lib/ai/write-decision';

export const DRAFT_STORE_UNAVAILABLE_CLARIFY =
  'ระบบยังเก็บคำขอต่อเนื่องไม่ได้ชั่วคราว กรุณาระบุวันที่ Project งาน และจำนวนชั่วโมงในข้อความเดียวครับ';

export const DRAFT_FOLLOWUP_UNAVAILABLE_CLARIFY =
  'ระบบยังโหลดคำขอค้างไว้ไม่ได้ชั่วคราว กรุณาส่งรายละเอียด Timesheet ครบในข้อความเดียวครับ (วันที่ Project งาน และจำนวนชั่วโมง)';

export const DRAFT_CANCELLED_MESSAGE =
  'ยกเลิกคำขอแล้วครับ ยังไม่มีการเตรียมรายการ Timesheet';

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
    return 'ต้องการลงงานอะไร และกี่ชั่วโมงครับ';
  }
  if (set.has('date') && (set.has('project') || set.has('task'))) {
    return 'ต้องการลงวันที่ไหน และให้ Project/งานอะไรครับ';
  }
  if (set.has('date')) return 'ต้องการลงวันที่ไหนครับ';
  if (set.has('project') && set.has('task')) {
    return 'ต้องการลงเวลาให้ Project และงานอะไรครับ';
  }
  if (set.has('project')) return 'ต้องการลงเวลาให้ Project อะไรครับ';
  if (set.has('task')) return 'ต้องการลงงานอะไรครับ';
  if (set.has('hours')) return 'ต้องการลงกี่ชั่วโมงครับ';
  if (set.has('matchEntry')) {
    return 'ต้องการแก้รายการวันที่ไหน และเปลี่ยนเป็นกี่ชั่วโมงครับ';
  }
  return 'ข้อมูล Timesheet ยังไม่ครบ กรุณาระบุรายละเอียดเพิ่มเติมครับ';
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

  let intent = rawIntent;
  let draftOutcome: string | undefined;

  if (options.draft) {
    const merge = await decideDraftMerge({
      intent: rawIntent,
      draft: options.draft,
      userMessage,
      now,
      resolveProjectFn: options.resolveProjectFn,
      resolveTaskFn: options.resolveTaskFn,
    });

    if (merge.merge) {
      intent = applyDraftMerge(rawIntent, options.draft, merge.fill);
    } else if (
      rawIntent.intent === 'general_conversation' ||
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
      rawIntent.intent === 'unknown' &&
      !looksLikeBusinessTimesheetText(userMessage)
    ) {
      return {
        decision: { action: 'none', reason: 'unknown_intent' },
        draftOutcome: 'draft_preserved',
      };
    }
    // else: new timesheet intent may replace draft via normal create path
  }

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

  const date =
    resolveDateExpression(intent.dateExpression, now) ||
    options.draft?.resolvedDate;

  const hours = parseHoursValue(intent.hours, options.userMessage);

  const projectHint =
    intent.projectHint?.trim() || options.draft?.projectHint || '';
  const taskHint = intent.taskHint?.trim() || options.draft?.taskHint || '';

  let resolvedProjectId = options.draft?.resolvedProjectId;
  let resolvedTaskId = options.draft?.resolvedTaskId;

  const missing = recomputeCreateMissingFields({
    date,
    hours,
    projectHint,
    resolvedProjectId,
    taskHint,
    resolvedTaskId,
  });

  if (missing.length > 0) {
    const saved = await persistDraft(options, {
      intent: 'create_timesheet_entry',
      dateExpression: intent.dateExpression || undefined,
      resolvedDate: date,
      projectHint: projectHint || undefined,
      resolvedProjectId,
      taskHint: taskHint || undefined,
      resolvedTaskId,
      hours,
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
        reason: 'ai_intent_create_missing_fields',
      },
      draftOutcome: saved.outcome,
      draftStoreAvailable: true,
    };
  }

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
    if (proj.status === 'not_found') {
      return {
        decision: {
          action: 'clarify',
          message: `ไม่พบ Project ที่ตรงกับ “${projectHint}” ครับ ลองระบุชื่อหรือรหัส Project อีกครั้ง`,
          reason: 'project_not_found',
        },
      };
    }
    if (proj.status === 'ambiguous') {
      const list = proj.candidates
        .slice(0, 5)
        .map((p, i) => `${i + 1}. ${formatProjectLabel(p)}`)
        .join('\n');
      return {
        decision: {
          action: 'clarify',
          message: `พบหลาย Project ที่ใกล้เคียงครับ กรุณาเลือก:\n${list}`,
          reason: 'ambiguous_project',
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
    if (task.status === 'not_found') {
      return {
        decision: {
          action: 'clarify',
          message: `ไม่พบงานที่ตรงกับ “${taskHint}” ครับ ลองระบุชื่องานอีกครั้ง`,
          reason: 'task_not_found',
        },
      };
    }
    if (task.status === 'ambiguous') {
      const list = task.candidates
        .slice(0, 5)
        .map((t, i) => `${i + 1}. ${t.Task}`)
        .join('\n');
      return {
        decision: {
          action: 'clarify',
          message: `พบหลายงานที่ใกล้เคียงครับ กรุณาเลือก:\n${list}`,
          reason: 'ambiguous_task',
        },
      };
    }
    resolvedTaskId = task.value.TaskID;
  }

  if (!date || hours === undefined || !resolvedProjectId || !resolvedTaskId) {
    return {
      decision: {
        action: 'clarify',
        message: clarifyMissing(['date', 'project', 'task', 'hours']),
        reason: 'validation_failed',
      },
    };
  }

  await clearDraft(options);
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

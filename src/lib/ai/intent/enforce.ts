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
  type IntentDraftStore,
} from '@/lib/ai/intent/draft-store';
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

export type EnforceIntentOptions = {
  now?: Date;
  pendingChanges?: PendingSummary[];
  draft?: IntentDraft | null;
  draftStore?: IntentDraftStore;
  conversationId?: string;
  slackUserId?: string;
  /** Injectable resolvers for tests */
  resolveProjectFn?: typeof resolveProject;
  resolveTaskFn?: typeof resolveTask;
  userMessage?: string;
};

function mergeWithDraft(
  intent: StructuredIntent,
  draft: IntentDraft | null | undefined,
  userMessage: string
): StructuredIntent {
  if (!draft) return intent;

  const merged: StructuredIntent = {
    ...intent,
    intent:
      intent.intent === 'unknown' ||
      intent.intent === 'general_conversation'
        ? draft.intent
        : intent.intent,
    domain:
      intent.domain === 'unknown' || intent.domain === 'general'
        ? 'timesheet'
        : intent.domain,
    dateExpression:
      intent.dateExpression || draft.dateExpression || draft.resolvedDate || null,
    projectHint: intent.projectHint || draft.projectHint || null,
    taskHint: intent.taskHint || draft.taskHint || null,
    hours:
      intent.hours ??
      draft.hours ??
      null,
    refersToPrevious: true,
  };

  // Short follow-up: fill first missing field with the whole message
  const trimmed = userMessage.trim();
  if (
    trimmed &&
    trimmed.length <= 40 &&
    draft.missingFields.length > 0 &&
    !intent.projectHint &&
    !intent.taskHint &&
    intent.hours == null &&
    !intent.dateExpression
  ) {
    const field = draft.missingFields[0]!;
    if (field === 'task' && !merged.taskHint) merged.taskHint = trimmed;
    else if (field === 'project' && !merged.projectHint) {
      merged.projectHint = trimmed;
    } else if (field === 'hours' && merged.hours == null) {
      const n = Number(trimmed.replace(/[^\d.]/g, ''));
      if (Number.isFinite(n)) merged.hours = n;
    } else if (field === 'date' && !merged.dateExpression) {
      merged.dateExpression = trimmed;
    }
  }

  return merged;
}

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
): Promise<void> {
  if (!opts.draftStore || !opts.conversationId || !opts.slackUserId) return;
  await opts.draftStore.set(
    buildDraftFromSlots({
      ...slots,
      conversationId: opts.conversationId,
      slackUserId: opts.slackUserId,
      now: opts.now,
    })
  );
}

async function clearDraft(opts: EnforceIntentOptions): Promise<void> {
  if (!opts.draftStore || !opts.conversationId || !opts.slackUserId) return;
  await opts.draftStore.clear(opts.conversationId, opts.slackUserId);
}

/**
 * Map validated structured intent to a BusinessToolDecision.
 */
export async function enforceStructuredIntent(
  rawIntent: StructuredIntent,
  options: EnforceIntentOptions = {}
): Promise<BusinessToolDecision> {
  const now = options.now ?? new Date();
  const pending = options.pendingChanges ?? [];
  const userMessage = options.userMessage || '';

  // Deterministic bare confirm/cancel always wins
  if (isBareConfirmPhrase(userMessage) || isBareCancelPhrase(userMessage)) {
    const cc = resolveConfirmOrCancel(userMessage, pending);
    if (cc) {
      await clearDraft(options);
      return cc;
    }
  }

  const intent = mergeWithDraft(rawIntent, options.draft, userMessage);

  switch (intent.intent) {
    case 'general_conversation':
      await clearDraft(options);
      return { action: 'none', reason: 'general_conversation' };

    case 'unknown':
      if (options.draft || intent.domain === 'timesheet') {
        return {
          action: 'clarify',
          message:
            'ต้องการทำรายการ Timesheet แบบไหนครับ (ลงเวลา / แก้ / ลบ / ดูข้อมูล)',
          reason: 'unknown_business_intent',
        };
      }
      return { action: 'none', reason: 'unknown_intent' };

    case 'get_my_profile':
      await clearDraft(options);
      return {
        action: 'call_tool',
        toolName: 'get_my_profile',
        arguments: {},
        reason: 'ai_intent_get_my_profile',
      };

    case 'get_work_context':
      await clearDraft(options);
      return {
        action: 'call_tool',
        toolName: 'get_work_context',
        arguments: {},
        reason: 'ai_intent_get_work_context',
      };

    case 'get_timesheet_day': {
      await clearDraft(options);
      const date =
        resolveDateExpression(intent.dateExpression, now) ||
        options.draft?.resolvedDate;
      if (!date || !isValidIsoDate(date)) {
        return {
          action: 'clarify',
          message: 'Which date or date range do you mean?',
          reason: 'missing_timesheet_period',
        };
      }
      return {
        action: 'call_tool',
        toolName: 'get_timesheet',
        arguments: { date },
        reason: 'ai_intent_get_timesheet_day',
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
          action: 'clarify',
          message: 'Which date or date range do you mean?',
          reason: 'missing_timesheet_period',
        };
      }
      return {
        action: 'call_tool',
        toolName: 'get_timesheet_range',
        arguments: range,
        reason: 'ai_intent_get_timesheet_range',
      };
    }

    case 'confirm_timesheet_change': {
      await clearDraft(options);
      const cc = resolveConfirmOrCancel('ยืนยัน', pending);
      if (cc) return cc;
      return {
        action: 'clarify',
        message:
          'ยืนยันอะไรครับ ตอนนี้ไม่มีรายการ Timesheet ที่รอการยืนยัน',
        reason: 'confirm_without_pending',
      };
    }

    case 'cancel_timesheet_change': {
      await clearDraft(options);
      const cc = resolveConfirmOrCancel('ยกเลิก', pending);
      if (cc) return cc;
      return {
        action: 'clarify',
        message: 'ตอนนี้ไม่มีรายการ Timesheet ที่รอการยืนยันครับ',
        reason: 'cancel_without_pending',
      };
    }

    case 'submit_timesheet': {
      await clearDraft(options);
      const week = resolveRangeExpressions('สัปดาห์นี้', null, now);
      return {
        action: 'call_tool',
        toolName: 'prepare_submit_timesheet',
        arguments: { weekStart: week?.startDate },
        reason: 'ai_intent_submit_timesheet',
      };
    }

    case 'create_timesheet_entry':
      return enforceCreate(intent, options, now);

    case 'update_timesheet_entry':
      return enforceUpdate(intent, options, now);

    case 'delete_timesheet_entry':
      return enforceDelete(intent, options, now);

    default:
      return {
        action: 'clarify',
        message:
          'ต้องการทำรายการ Timesheet แบบไหนครับ (ลงเวลา / แก้ / ลบ / ดูข้อมูล)',
        reason: 'unknown_business_intent',
      };
  }
}

async function enforceCreate(
  intent: StructuredIntent,
  options: EnforceIntentOptions,
  now: Date
): Promise<BusinessToolDecision> {
  const resolveProj = options.resolveProjectFn ?? resolveProject;
  const resolveTk = options.resolveTaskFn ?? resolveTask;
  const missing: IntentMissingField[] = [];

  const date =
    resolveDateExpression(intent.dateExpression, now) ||
    options.draft?.resolvedDate;
  if (!date) missing.push('date');

  const hours = parseHoursValue(intent.hours, options.userMessage);
  if (hours === undefined) missing.push('hours');

  const projectHint =
    intent.projectHint?.trim() || options.draft?.projectHint || '';
  const taskHint = intent.taskHint?.trim() || options.draft?.taskHint || '';

  let resolvedProjectId = options.draft?.resolvedProjectId;
  let resolvedTaskId = options.draft?.resolvedTaskId;

  if (!projectHint && !resolvedProjectId) missing.push('project');
  if (!taskHint && !resolvedTaskId) missing.push('task');

  if (missing.length > 0) {
    await persistDraft(options, {
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
    return {
      action: 'clarify',
      message: clarifyMissing(missing),
      reason: 'ai_intent_create_missing_fields',
    };
  }

  if (!resolvedProjectId && projectHint) {
    let proj: Awaited<ReturnType<typeof resolveProj>>;
    try {
      proj = await resolveProj({ projectName: projectHint });
    } catch {
      return {
        action: 'clarify',
        message:
          'ยังไม่สามารถค้นหา Project ได้ในขณะนี้ครับ กรุณาลองใหม่อีกครั้ง',
        reason: 'read_failed',
      };
    }
    if (proj.status === 'not_found') {
      return {
        action: 'clarify',
        message: `ไม่พบ Project ที่ตรงกับ “${projectHint}” ครับ ลองระบุชื่อหรือรหัส Project อีกครั้ง`,
        reason: 'project_not_found',
      };
    }
    if (proj.status === 'ambiguous') {
      const list = proj.candidates
        .slice(0, 5)
        .map((p, i) => `${i + 1}. ${formatProjectLabel(p)}`)
        .join('\n');
      return {
        action: 'clarify',
        message: `พบหลาย Project ที่ใกล้เคียงครับ กรุณาเลือก:\n${list}`,
        reason: 'ambiguous_project',
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
        action: 'clarify',
        message:
          'ยังไม่สามารถค้นหางานได้ในขณะนี้ครับ กรุณาลองใหม่อีกครั้ง',
        reason: 'read_failed',
      };
    }
    if (task.status === 'not_found') {
      return {
        action: 'clarify',
        message: `ไม่พบงานที่ตรงกับ “${taskHint}” ครับ ลองระบุชื่องานอีกครั้ง`,
        reason: 'task_not_found',
      };
    }
    if (task.status === 'ambiguous') {
      const list = task.candidates
        .slice(0, 5)
        .map((t, i) => `${i + 1}. ${t.Task}`)
        .join('\n');
      return {
        action: 'clarify',
        message: `พบหลายงานที่ใกล้เคียงครับ กรุณาเลือก:\n${list}`,
        reason: 'ambiguous_task',
      };
    }
    resolvedTaskId = task.value.TaskID;
  }

  if (!date || hours === undefined || !resolvedProjectId || !resolvedTaskId) {
    return {
      action: 'clarify',
      message: clarifyMissing(['date', 'project', 'task', 'hours']),
      reason: 'validation_failed',
    };
  }

  await clearDraft(options);
  return {
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
  };
}

async function enforceUpdate(
  intent: StructuredIntent,
  options: EnforceIntentOptions,
  now: Date
): Promise<BusinessToolDecision> {
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
    await persistDraft(options, {
      intent: 'update_timesheet_entry',
      dateExpression: intent.dateExpression || undefined,
      resolvedDate: date,
      projectHint: projectHint || undefined,
      hours,
      missingFields: missing.length ? missing : ['matchEntry'],
    });
    return {
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
    };
  }

  await clearDraft(options);
  return {
    action: 'call_tool',
    toolName: 'prepare_update_timesheet_entry',
    arguments: {
      date,
      matchProjectName: projectHint,
      hours,
    },
    reason: 'ai_intent_update_entry',
  };
}

async function enforceDelete(
  intent: StructuredIntent,
  options: EnforceIntentOptions,
  now: Date
): Promise<BusinessToolDecision> {
  const missing: IntentMissingField[] = [];
  const date =
    resolveDateExpression(intent.dateExpression, now) ||
    options.draft?.resolvedDate;
  const projectHint =
    intent.projectHint?.trim() || options.draft?.projectHint || '';

  if (!date) missing.push('date');
  if (!projectHint) missing.push('project');

  if (missing.length > 0) {
    await persistDraft(options, {
      intent: 'delete_timesheet_entry',
      dateExpression: intent.dateExpression || undefined,
      resolvedDate: date,
      projectHint: projectHint || undefined,
      missingFields: missing,
    });
    return {
      action: 'clarify',
      message: clarifyMissing(missing),
      reason: 'ai_intent_delete_missing_fields',
    };
  }

  await clearDraft(options);
  return {
    action: 'call_tool',
    toolName: 'prepare_delete_timesheet_entry',
    arguments: {
      date,
      matchProjectName: projectHint,
    },
    reason: 'ai_intent_delete_entry',
  };
}

export function looksLikeBusinessTimesheetText(text: string): boolean {
  return /(ลงเวลา|บันทึกเวลา|timesheet|ชั่วโมง|ชม\.?|hours?|hrs?|project|โปรเจกต์|งาน\s|rms|\blog\s+\d|add\s+.*hour|แก้เวลา|ลบรายการ|submit|ลงเวลางาน)/i.test(
    text
  );
}

export { draftSummary };

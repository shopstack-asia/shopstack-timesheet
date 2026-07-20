import type { BusinessToolDecision } from '@/lib/ai/decision-engine';
import {
  PENDING_ACTION_CONFIDENCE_THRESHOLD,
  confidenceBand,
  type PendingResponseEnforcementOutcome,
  type PendingResponseExtraction,
  type PendingResponseExtractorOutcome,
  type SafePendingProposalContext,
} from '@/lib/ai/pending-response/types';
import type { PendingTimesheetChange } from '@/lib/timesheet/write/pending-types';

export type OwnedPendingRef = {
  confirmationId: string;
  operation: PendingTimesheetChange['operation'];
  date?: string;
  summaryPayload: Record<string, unknown>;
  proposal: SafePendingProposalContext;
};

function looksThai(text: string): boolean {
  return /[\u0E00-\u0E7F]/.test(text);
}

export function pendingClarifyMessage(
  userMessage: string,
  kind:
    | 'ambiguous'
    | 'low_confidence'
    | 'extractor_failure'
    | 'conflict'
    | 'cancel_vs_correction'
): string {
  const th = looksThai(userMessage);
  if (kind === 'extractor_failure') {
    return th
      ? 'ยังไม่สามารถตีความคำตอบของท่านได้ครับ กรุณาตอบอีกครั้งว่าต้องการยืนยัน ยกเลิก หรือแก้ไขรายการที่รออยู่ครับ'
      : 'I couldn’t interpret that reply. Please say whether you want to confirm, cancel, or change the pending Timesheet proposal.';
  }
  if (kind === 'cancel_vs_correction') {
    return th
      ? 'คำตอบดูเหมือนทั้งยกเลิกและแก้ไขครับ ต้องการยกเลิกรายการที่รออยู่ หรือแก้ไขรายละเอียด (วันที่ Project งาน ชั่วโมง) ครับ?'
      : 'That sounds like both cancel and a change. Do you want to cancel the pending proposal, or replace it with corrected details?';
  }
  if (kind === 'conflict') {
    return th
      ? 'คำตอบยังขัดกันอยู่ครับ ต้องการยืนยันตามที่เสนอ ยกเลิก หรือแก้ไขส่วนไหนเป็นพิเศษครับ?'
      : 'That reply looks mixed. Do you want to confirm the proposal, cancel it, or change something specific?';
  }
  if (kind === 'low_confidence') {
    return th
      ? 'ขออภัย ยังไม่แน่ใจในคำตอบครับ ต้องการยืนยันรายการนี้ ยกเลิก หรือแก้ไขครับ?'
      : 'I’m not sure how to treat that reply. Would you like to confirm this proposal, cancel it, or change it?';
  }
  return th
    ? 'ต้องการยืนยันรายการที่รออยู่ ยกเลิก หรือแก้ไขรายละเอียดครับ?'
    : 'Would you like to confirm the pending proposal, cancel it, or change the details?';
}

export function correctionClarifyMessage(
  userMessage: string,
  missing: string[]
): string {
  const th = looksThai(userMessage);
  if (missing.includes('hours')) {
    return th
      ? 'ต้องการเปลี่ยนเป็นกี่ชั่วโมงครับ?'
      : 'How many hours should it be changed to?';
  }
  if (missing.includes('project')) {
    return th
      ? 'ต้องการเปลี่ยนเป็น Project ไหนครับ?'
      : 'Which project should it be changed to?';
  }
  if (missing.includes('task')) {
    return th ? 'ต้องการเปลี่ยนเป็นงานประเภทไหนครับ?' : 'Which task should it be?';
  }
  if (missing.includes('date')) {
    return th ? 'ต้องการเปลี่ยนเป็นวันที่ไหนครับ?' : 'Which date should it be?';
  }
  return th
    ? 'ต้องการแก้ไขส่วนไหนของรายการที่รออยู่ครับ (วันที่ Project งาน หรือชั่วโมง)?'
    : 'Which part of the pending proposal should change (date, project, task, or hours)?';
}

function correctionHasAnyHint(
  extraction: PendingResponseExtraction
): boolean {
  const c = extraction.correction;
  if (!c) return false;
  return Boolean(
    c.dateHint?.trim() ||
      c.projectHint?.trim() ||
      c.taskHint?.trim() ||
      (typeof c.hours === 'number' && Number.isFinite(c.hours))
  );
}

export function isConfirmAuthorized(
  extraction: PendingResponseExtraction
):
  | { ok: true }
  | {
      ok: false;
      outcome: 'clarify_low_confidence' | 'clarify_conflict';
    } {
  if (extraction.intent !== 'confirm') {
    return { ok: false, outcome: 'clarify_conflict' };
  }
  if (extraction.confidence < PENDING_ACTION_CONFIDENCE_THRESHOLD) {
    return { ok: false, outcome: 'clarify_low_confidence' };
  }
  if (extraction.hasNewMutation) {
    return { ok: false, outcome: 'clarify_conflict' };
  }
  if (extraction.correction !== null) {
    return { ok: false, outcome: 'clarify_conflict' };
  }
  return { ok: true };
}

/**
 * Deterministic cancel authorization — same conservative threshold as confirm.
 * “Cancellation wins” only for clear, high-confidence cancel without mutation signals.
 */
export function isCancelAuthorized(
  extraction: PendingResponseExtraction
):
  | { ok: true }
  | {
      ok: false;
      outcome: 'clarify_low_confidence' | 'clarify_conflict';
    } {
  if (extraction.intent !== 'cancel') {
    return { ok: false, outcome: 'clarify_conflict' };
  }
  if (extraction.confidence < PENDING_ACTION_CONFIDENCE_THRESHOLD) {
    return { ok: false, outcome: 'clarify_low_confidence' };
  }
  if (extraction.hasNewMutation) {
    return { ok: false, outcome: 'clarify_conflict' };
  }
  if (extraction.correction !== null) {
    return { ok: false, outcome: 'clarify_conflict' };
  }
  return { ok: true };
}

export type EnforcePendingResponseResult = {
  decision: BusinessToolDecision;
  enforcementOutcome: PendingResponseEnforcementOutcome;
  confidenceBand: ReturnType<typeof confidenceBand>;
  correctionPrepare?: {
    toolName:
      | 'prepare_create_timesheet_entry'
      | 'prepare_update_timesheet_entry'
      | 'prepare_delete_timesheet_entry';
    arguments: Record<string, unknown>;
    cancelConfirmationId: string;
  };
};

export function enforcePendingResponse(input: {
  userMessage: string;
  extraction: PendingResponseExtraction;
  ownedPending: OwnedPendingRef;
}): EnforcePendingResponseResult {
  const { extraction, ownedPending, userMessage } = input;
  const band = confidenceBand(extraction.confidence);

  if (extraction.intent === 'cancel') {
    const gate = isCancelAuthorized(extraction);
    if (!gate.ok) {
      const kind =
        gate.outcome === 'clarify_low_confidence'
          ? 'low_confidence'
          : extraction.hasNewMutation || extraction.correction !== null
            ? 'cancel_vs_correction'
            : 'conflict';
      return {
        decision: {
          action: 'clarify',
          message: pendingClarifyMessage(userMessage, kind),
          reason: gate.outcome,
        },
        enforcementOutcome: gate.outcome,
        confidenceBand: band,
      };
    }
    return {
      decision: {
        action: 'call_tool',
        toolName: 'cancel_timesheet_change',
        arguments: { confirmationId: ownedPending.confirmationId },
        reason: 'pending_semantic_cancel',
      },
      enforcementOutcome: 'cancel_authorized',
      confidenceBand: band,
    };
  }

  if (extraction.intent === 'unrelated') {
    return {
      decision: {
        action: 'none',
        reason: 'pending_unrelated_passthrough',
      },
      enforcementOutcome: 'unrelated_passthrough',
      confidenceBand: band,
    };
  }

  if (extraction.intent === 'ambiguous') {
    return {
      decision: {
        action: 'clarify',
        message: pendingClarifyMessage(userMessage, 'ambiguous'),
        reason: 'pending_response_ambiguous',
      },
      enforcementOutcome: 'clarify_ambiguous',
      confidenceBand: band,
    };
  }

  if (extraction.intent === 'correction' || extraction.hasNewMutation) {
    return enforceCorrection(userMessage, extraction, ownedPending, band);
  }

  if (extraction.intent === 'confirm') {
    const gate = isConfirmAuthorized(extraction);
    if (!gate.ok) {
      return {
        decision: {
          action: 'clarify',
          message: pendingClarifyMessage(
            userMessage,
            gate.outcome === 'clarify_low_confidence'
              ? 'low_confidence'
              : 'conflict'
          ),
          reason: gate.outcome,
        },
        enforcementOutcome: gate.outcome,
        confidenceBand: band,
      };
    }
    return {
      decision: {
        action: 'call_tool',
        toolName: 'confirm_timesheet_change',
        arguments: { confirmationId: ownedPending.confirmationId },
        reason: 'pending_semantic_confirm',
      },
      enforcementOutcome: 'confirm_authorized',
      confidenceBand: band,
    };
  }

  return {
    decision: {
      action: 'clarify',
      message: pendingClarifyMessage(userMessage, 'ambiguous'),
      reason: 'pending_response_ambiguous',
    },
    enforcementOutcome: 'clarify_ambiguous',
    confidenceBand: band,
  };
}

function enforceCorrection(
  userMessage: string,
  extraction: PendingResponseExtraction,
  ownedPending: OwnedPendingRef,
  band: ReturnType<typeof confidenceBand>
): EnforcePendingResponseResult {
  if (!correctionHasAnyHint(extraction)) {
    return {
      decision: {
        action: 'clarify',
        message: correctionClarifyMessage(userMessage, []),
        reason: 'pending_correction_incomplete',
      },
      enforcementOutcome: 'correction_clarify',
      confidenceBand: band,
    };
  }

  const c = extraction.correction!;
  const payload = ownedPending.summaryPayload;
  const date =
    c.dateHint?.trim() ||
    (typeof payload.date === 'string' ? payload.date : undefined) ||
    ownedPending.date ||
    ownedPending.proposal.date;
  const projectName =
    c.projectHint?.trim() ||
    (typeof payload.projectName === 'string'
      ? payload.projectName
      : undefined) ||
    ownedPending.proposal.projectName;
  const taskName =
    c.taskHint?.trim() ||
    (typeof payload.taskName === 'string' ? payload.taskName : undefined) ||
    ownedPending.proposal.taskName;
  const hours =
    typeof c.hours === 'number' && Number.isFinite(c.hours)
      ? c.hours
      : typeof payload.hours === 'number'
        ? payload.hours
        : typeof payload.toHours === 'number'
          ? payload.toHours
          : ownedPending.proposal.hours;

  const missing: string[] = [];
  if (!date) missing.push('date');
  if (ownedPending.operation !== 'delete_entry' && hours === undefined) {
    missing.push('hours');
  }
  if (!projectName) missing.push('project');
  if (ownedPending.operation === 'create_entry' && !taskName) {
    missing.push('task');
  }

  if (missing.length > 0) {
    return {
      decision: {
        action: 'clarify',
        message: correctionClarifyMessage(userMessage, missing),
        reason: 'pending_correction_incomplete',
      },
      enforcementOutcome: 'correction_clarify',
      confidenceBand: band,
    };
  }

  if (ownedPending.operation === 'delete_entry') {
    return {
      decision: {
        action: 'call_tool',
        toolName: 'prepare_delete_timesheet_entry',
        arguments: {
          date,
          matchProjectName: projectName,
          ...(taskName ? { matchTaskName: taskName } : {}),
        },
        reason: 'pending_semantic_correction',
      },
      enforcementOutcome: 'correction_prepare',
      confidenceBand: band,
      correctionPrepare: {
        toolName: 'prepare_delete_timesheet_entry',
        arguments: {
          date,
          matchProjectName: projectName,
          ...(taskName ? { matchTaskName: taskName } : {}),
        },
        cancelConfirmationId: ownedPending.confirmationId,
      },
    };
  }

  if (ownedPending.operation === 'update_entry') {
    return {
      decision: {
        action: 'call_tool',
        toolName: 'prepare_update_timesheet_entry',
        arguments: {
          date,
          matchProjectName:
            (typeof payload.projectName === 'string'
              ? payload.projectName
              : undefined) || projectName,
          hours,
          ...(c.projectHint?.trim()
            ? { projectName: c.projectHint.trim() }
            : {}),
          ...(c.taskHint?.trim() ? { taskName: c.taskHint.trim() } : {}),
        },
        reason: 'pending_semantic_correction',
      },
      enforcementOutcome: 'correction_prepare',
      confidenceBand: band,
      correctionPrepare: {
        toolName: 'prepare_update_timesheet_entry',
        arguments: {
          date,
          matchProjectName:
            (typeof payload.projectName === 'string'
              ? payload.projectName
              : undefined) || projectName,
          hours,
          ...(c.projectHint?.trim()
            ? { projectName: c.projectHint.trim() }
            : {}),
          ...(c.taskHint?.trim() ? { taskName: c.taskHint.trim() } : {}),
        },
        cancelConfirmationId: ownedPending.confirmationId,
      },
    };
  }

  return {
    decision: {
      action: 'call_tool',
      toolName: 'prepare_create_timesheet_entry',
      arguments: {
        date,
        hours,
        projectName,
        taskName,
      },
      reason: 'pending_semantic_correction',
    },
    enforcementOutcome: 'correction_prepare',
    confidenceBand: band,
    correctionPrepare: {
      toolName: 'prepare_create_timesheet_entry',
      arguments: {
        date,
        hours,
        projectName,
        taskName,
      },
      cancelConfirmationId: ownedPending.confirmationId,
    },
  };
}

export function enforceExtractorFailure(
  userMessage: string,
  extractorOutcome: PendingResponseExtractorOutcome
): EnforcePendingResponseResult {
  return {
    decision: {
      action: 'clarify',
      message: pendingClarifyMessage(userMessage, 'extractor_failure'),
      reason: `pending_extractor_${extractorOutcome}`,
    },
    enforcementOutcome: 'clarify_extractor_failure',
    confidenceBand: 'none',
  };
}

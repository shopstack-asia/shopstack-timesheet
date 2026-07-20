/**
 * Write-intent helpers for the Decision Engine (prepare args + legacy regex).
 *
 * Production pending confirm/cancel authorization uses semantic pending-response
 * extraction (`src/lib/ai/pending-response/*`) — NOT phrase lists or regex.
 * `isBareConfirmPhrase` / `resolveConfirmOrCancel` remain only for the legacy
 * `decideBusinessTool` path and historical tests — never as write authorization
 * on the `runConversation` production path.
 */

import {
  bangkokToday,
  bangkokTomorrow,
  bangkokYesterday,
  bangkokCurrentWeek,
} from '@/lib/tools/business/timesheet/bangkok-dates';

export type PendingSummary = {
  confirmationId: string;
  summary: string;
};

export type WriteToolName =
  | 'prepare_create_timesheet_entry'
  | 'prepare_update_timesheet_entry'
  | 'prepare_delete_timesheet_entry'
  | 'prepare_submit_timesheet'
  | 'confirm_timesheet_change'
  | 'cancel_timesheet_change';

const CONFIRM_RE =
  /^(ยืนยัน|ตกลง|ทำเลย|ใช่\s*ยืนยัน|confirm|yes[,\s]*confirm|proceed|do\s*it)[\s!.?]*$/i;

const CANCEL_RE =
  /^(ยกเลิก|ไม่ทำแล้ว|ไม่ต้องบันทึก|cancel|never\s*mind|do\s*not\s*save|don't\s*save)[\s!.?]*$/i;

const CREATE_RE =
  /(เพิ่ม\s*timesheet|เพิ่มเวลาทำงาน|บันทึกเวลา|\blog\s+time\b|\badd\s+(a\s+)?timesheet\b|\brecord\s+\d|\blog\s+\d+\s+hours?\b|ลงเวลา(?:เมื่อวาน|วันนี้|พรุ่งนี้|ให้|\s+\d)|ลงเวลา.+(?:ชั่วโมง|hours?))/i;

/** Read-style "how many hours did I log" must not become create. */
function isLoggedHoursQuestion(text: string): boolean {
  return (
    /(ลงเวลาไปกี่|กี่ชั่วโมง|how\s+many\s+hours\s+did\s+i|hours?\s+did\s+i\s+log)/i.test(
      text
    ) && !/(ให้|งาน|เพิ่ม|บันทึก|log\s+\d)/i.test(text)
  );
}

const UPDATE_RE =
  /(แก้เวลา|แก้รายการ|ปรับชั่วโมง|เปลี่ยนจาก|\bupdate\s+(the\s+)?entry\b|\bchange\s+.+\s+hours?\b|\bedit\s+.+\s+entry\b|แก้\s+\w+)/i;

const DELETE_RE =
  /(ลบรายการ|ลบ\s*timesheet|เอารายการ|\bdelete\s+(the\s+)?entry\b|\bremove\s+(the\s+)?(timesheet\s+)?entry\b)/i;

const SUBMIT_RE =
  /(submit\s+(this\s+week|my\s+timesheet|timesheet)|ส่ง\s*timesheet|ยืนยัน\s*timesheet\s*สัปดาห์)/i;

export function isBareConfirmPhrase(text: string): boolean {
  return CONFIRM_RE.test(text.trim());
}

export function isBareCancelPhrase(text: string): boolean {
  return CANCEL_RE.test(text.trim());
}

export function isCreateTimesheetIntent(text: string): boolean {
  if (isLoggedHoursQuestion(text)) return false;
  return CREATE_RE.test(text) && !UPDATE_RE.test(text) && !DELETE_RE.test(text);
}

export function isUpdateTimesheetIntent(text: string): boolean {
  return UPDATE_RE.test(text);
}

export function isDeleteTimesheetIntent(text: string): boolean {
  return DELETE_RE.test(text);
}

export function isSubmitTimesheetIntent(text: string): boolean {
  return SUBMIT_RE.test(text);
}

export function isTimesheetWriteIntent(text: string): boolean {
  return (
    isCreateTimesheetIntent(text) ||
    isUpdateTimesheetIntent(text) ||
    isDeleteTimesheetIntent(text) ||
    isSubmitTimesheetIntent(text)
  );
}

function resolveDateWord(text: string, now: Date): string | undefined {
  if (/\btomorrow\b/i.test(text) || text.includes('พรุ่งนี้')) {
    return bangkokTomorrow(now);
  }
  if (/\byesterday\b/i.test(text) || text.includes('เมื่อวาน')) {
    return bangkokYesterday(now);
  }
  if (/\btoday\b/i.test(text) || text.includes('วันนี้')) {
    return bangkokToday(now);
  }
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return iso?.[1];
}

function extractHours(text: string): number | undefined {
  const m =
    text.match(/(\d+(?:\.\d+)?)\s*(ชั่วโมง|ชม\.?|hours?|hrs?)/i) ||
    text.match(/(?:เป็น|to|เป็น)\s*(\d+(?:\.\d+)?)/i) ||
    text.match(/\b(\d+(?:\.\d+)?)\s*(?:ชั่วโมง)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** Rough client/project token after ให้ / to / for */
function extractProjectHint(text: string): string | undefined {
  const m =
    text.match(
      /(?:ให้|to|for|รายการ)\s+([A-Za-z][\w\s-]{1,40}?)(?:\s+งาน|\s+\d|\s+จาก|\s+เป็น|\s+ของ|\s*$)/i
    ) || text.match(/([A-Za-z][A-Za-z0-9_-]{2,})/);
  const raw = m?.[1]?.trim();
  if (!raw) return undefined;
  // Avoid catching common verbs
  if (/^(yesterday|today|tomorrow|hours?|timesheet|development|management)$/i.test(raw)) {
    return undefined;
  }
  return raw.split(/\s+/).slice(0, 3).join(' ');
}

function extractTaskHint(text: string): string | undefined {
  const m =
    text.match(/งาน\s+([A-Za-z][\w\s/-]{1,40}?)(?:\s+\d|\s*$)/i) ||
    text.match(
      /\b(Development|Project Management|QA|Design|Meeting|Support|Management)\b/i
    );
  return m?.[1]?.trim();
}

export function buildCreatePrepareArgs(
  text: string,
  now: Date
):
  | { ok: true; arguments: Record<string, unknown> }
  | { ok: false; message: string } {
  const date = resolveDateWord(text, now);
  const hours = extractHours(text);
  const projectName = extractProjectHint(text);
  const taskName = extractTaskHint(text);

  if (!date && !hours && !projectName && !taskName) {
    return {
      ok: false,
      message:
        'ข้อมูล Timesheet ยังไม่ครบ กรุณาระบุวันที่ Project งาน และจำนวนชั่วโมงครับ',
    };
  }
  if (!date) {
    return { ok: false, message: 'ต้องการลงวันที่ไหนครับ' };
  }
  if (!projectName) {
    return { ok: false, message: 'ต้องการลงเวลาให้ Project และงานอะไรครับ' };
  }
  if (!taskName) {
    return { ok: false, message: 'ต้องการลงงานประเภทอะไรครับ' };
  }
  if (hours === undefined) {
    return { ok: false, message: 'ต้องการลงกี่ชั่วโมงครับ' };
  }

  return {
    ok: true,
    arguments: {
      date,
      hours,
      projectName,
      taskName,
    },
  };
}

export function buildUpdatePrepareArgs(
  text: string,
  now: Date
):
  | { ok: true; arguments: Record<string, unknown> }
  | { ok: false; message: string } {
  const date = resolveDateWord(text, now);
  const hours = extractHours(text);
  const matchProjectName = extractProjectHint(text);

  if (!date) {
    return { ok: false, message: 'ต้องการแก้รายการวันที่ไหนครับ' };
  }
  if (!matchProjectName) {
    return { ok: false, message: 'ต้องการแก้รายการของ Project ไหนครับ' };
  }
  if (hours === undefined) {
    return { ok: false, message: 'ต้องการเปลี่ยนเป็นกี่ชั่วโมงครับ' };
  }

  return {
    ok: true,
    arguments: {
      date,
      matchProjectName,
      hours,
    },
  };
}

export function buildDeletePrepareArgs(
  text: string,
  now: Date
):
  | { ok: true; arguments: Record<string, unknown> }
  | { ok: false; message: string } {
  const date = resolveDateWord(text, now);
  const matchProjectName = extractProjectHint(text);

  if (!date) {
    return { ok: false, message: 'ต้องการลบรายการวันที่ไหนครับ' };
  }
  if (!matchProjectName) {
    return { ok: false, message: 'ต้องการลบรายการของ Project ไหนครับ' };
  }

  return {
    ok: true,
    arguments: {
      date,
      matchProjectName,
    },
  };
}

export function buildSubmitPrepareArgs(
  text: string,
  now: Date
): Record<string, unknown> {
  const week = bangkokCurrentWeek(now);
  return { weekStart: week.startDate };
}

export function resolveConfirmOrCancel(
  text: string,
  pending: PendingSummary[]
):
  | {
      action: 'call_tool';
      toolName: 'confirm_timesheet_change' | 'cancel_timesheet_change';
      arguments: Record<string, unknown>;
      reason: string;
    }
  | { action: 'clarify'; message: string; reason: string }
  | null {
  const t = text.trim();
  if (isBareConfirmPhrase(t)) {
    if (pending.length === 0) {
      return {
        action: 'clarify',
        message:
          'ยืนยันอะไรครับ ตอนนี้ไม่มีรายการ Timesheet ที่รอการยืนยัน',
        reason: 'confirm_without_pending',
      };
    }
    if (pending.length > 1) {
      const list = pending
        .map((p, i) => `${i + 1}. ${p.summary.split('\n')[0] || p.confirmationId}`)
        .join('\n');
      return {
        action: 'clarify',
        message: `มีหลายรายการที่รอการยืนยัน กรุณาเลือกรายการครับ\n${list}`,
        reason: 'confirm_ambiguous_pending',
      };
    }
    return {
      action: 'call_tool',
      toolName: 'confirm_timesheet_change',
      arguments: { confirmationId: pending[0]!.confirmationId },
      reason: 'confirm_pending_change',
    };
  }

  if (isBareCancelPhrase(t)) {
    if (pending.length === 0) {
      return {
        action: 'clarify',
        message: 'ตอนนี้ไม่มีรายการ Timesheet ที่รอการยืนยันครับ',
        reason: 'cancel_without_pending',
      };
    }
    if (pending.length === 1) {
      return {
        action: 'call_tool',
        toolName: 'cancel_timesheet_change',
        arguments: { confirmationId: pending[0]!.confirmationId },
        reason: 'cancel_pending_change',
      };
    }
    return {
      action: 'call_tool',
      toolName: 'cancel_timesheet_change',
      arguments: {},
      reason: 'cancel_pending_change',
    };
  }

  return null;
}

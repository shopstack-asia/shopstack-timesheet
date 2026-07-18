import {
  bangkokCurrentWeek,
  bangkokLastMonth,
  bangkokLastWeek,
  bangkokThisMonth,
  bangkokToday,
  bangkokTomorrow,
  bangkokYesterday,
  bangkokMostRecentWeekday,
} from '@/lib/tools/business/timesheet/bangkok-dates';
import {
  inclusiveDayCount,
  isValidCalendarDate,
} from '@/lib/tools/business/timesheet/date-input';
import { MAX_TIMESHEET_RANGE_DAYS } from '@/lib/tools/business/types';

export type BusinessToolDecision =
  | {
      action: 'call_tool';
      toolName: 'get_work_context' | 'get_timesheet' | 'get_timesheet_range';
      arguments: Record<string, unknown>;
      reason: string;
    }
  | {
      action: 'clarify';
      message: string;
      reason: string;
    }
  | {
      action: 'none';
      reason: string;
    };

export type DecideBusinessToolOptions = {
  now?: Date;
};

const GENERAL_ONLY_RE =
  /^(ขอบคุณ|thanks|thank\s*you|hello|hi|hey|สวัสดี|หวัดดี|good\s*(morning|afternoon|evening)|how\s+are\s+you|เล่าเรื่อง|joke|tell\s+me\s+a\s+(joke|story)|what\s+is\s+[a-z]|how\s+do\s+i\s+(code|program|write)|programming|javascript|typescript|python)\b/i;

const WORK_CONTEXT_RE =
  /\b(project|projects|client|clients|role|roles|work\s*context|เลือก\s*(project|client|role)|เปลี่ยน\s*(project|client|role))\b|ฉันมี\s*project|project\s*ที่|client\s*ของ|role\s*ของ|โปรเจกต์|โปรเจค|ลูกค้า|บทบาท/i;

const RANGE_RE =
  /(สัปดาห์|อาทิตย์|เดือน|weekly|monthly|this\s+week|last\s+week|this\s+month|last\s+month|สรุป|summary|ทั้งหมด|ชั่วโมง.*(สัปดาห์|เดือน|อาทิตย์)|hours?\s+(this|last)\s+(week|month))/i;

const DAY_RE =
  /(วันนี้|เมื่อวาน|พรุ่งนี้|tomorrow|today|yesterday|what\s+did\s+i\s+(do|log)|ทำอะไร|ลงอะไร|logged|timesheet|วัน(จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;

const ISO_DATE_GLOBAL_RE = /\b(\d{4}-\d{2}-\d{2})\b/g;
const BARE_DAY_RE = /วันที่\s*(\d{1,2})(?!\s*(เดือน|\/|-|\d))/i;

/** Explicit two-date range (Thai / English / hyphen). */
const EXPLICIT_RANGE_RE =
  /(?:จาก|ตั้งแต่|from|between)?\s*(\d{4}-\d{2}-\d{2})\s*(?:ถึง|to|and|-|–|—)\s*(\d{4}-\d{2}-\d{2})/i;

const WEEKDAY_TH: Record<string, number> = {
  อาทิตย์: 0,
  จันทร์: 1,
  อังคาร: 2,
  พุธ: 3,
  พฤหัส: 4,
  ศุกร์: 5,
  เสาร์: 6,
};

const WEEKDAY_EN: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function extractIsoDates(text: string): string[] {
  return [...text.matchAll(ISO_DATE_GLOBAL_RE)].map((m) => m[1]!);
}

function resolveExplicitRange(text: string): BusinessToolDecision | null {
  const paired = text.match(EXPLICIT_RANGE_RE);
  if (!paired) return null;

  const startDate = paired[1]!;
  const endDate = paired[2]!;

  if (!isValidCalendarDate(startDate) || !isValidCalendarDate(endDate)) {
    return {
      action: 'clarify',
      message:
        'One or both dates are not valid calendar dates. Please use YYYY-MM-DD (for example 2026-07-01 to 2026-07-10).',
      reason: 'invalid_explicit_range_date',
    };
  }

  if (startDate > endDate) {
    return {
      action: 'clarify',
      message:
        'The start date is after the end date. Please provide a valid range (startDate ≤ endDate).',
      reason: 'reversed_explicit_range',
    };
  }

  const days = inclusiveDayCount(startDate, endDate);
  if (days > MAX_TIMESHEET_RANGE_DAYS) {
    return {
      action: 'clarify',
      message: `That date range is too long (maximum ${MAX_TIMESHEET_RANGE_DAYS} calendar days). Please choose a shorter range.`,
      reason: 'explicit_range_too_long',
    };
  }

  return {
    action: 'call_tool',
    toolName: 'get_timesheet_range',
    arguments: { startDate, endDate },
    reason: 'explicit_date_range',
  };
}

function resolveSingleDay(
  text: string,
  now: Date
): BusinessToolDecision | null {
  const isos = extractIsoDates(text);
  if (isos.length >= 2) {
    // Should have been handled as an explicit range; do not collapse to single day.
    return {
      action: 'clarify',
      message:
        'Please provide the date range using a clear format such as 2026-07-01 to 2026-07-10.',
      reason: 'ambiguous_multi_iso_dates',
    };
  }

  if (isos.length === 1) {
    const date = isos[0]!;
    if (!isValidCalendarDate(date)) {
      return {
        action: 'clarify',
        message:
          'That date is not a valid calendar day. Please use YYYY-MM-DD (for example 2026-07-15).',
        reason: 'invalid_explicit_date',
      };
    }
    return {
      action: 'call_tool',
      toolName: 'get_timesheet',
      arguments: { date },
      reason: 'timesheet_day_intent',
    };
  }

  if (/(พรุ่งนี้|tomorrow)/i.test(text)) {
    return {
      action: 'call_tool',
      toolName: 'get_timesheet',
      arguments: { date: bangkokTomorrow(now) },
      reason: 'timesheet_day_intent',
    };
  }
  if (/(เมื่อวาน|yesterday)/i.test(text)) {
    return {
      action: 'call_tool',
      toolName: 'get_timesheet',
      arguments: { date: bangkokYesterday(now) },
      reason: 'timesheet_day_intent',
    };
  }
  if (/(วันนี้|today)/i.test(text)) {
    return {
      action: 'call_tool',
      toolName: 'get_timesheet',
      arguments: { date: bangkokToday(now) },
      reason: 'timesheet_day_intent',
    };
  }

  const thDay = Object.keys(WEEKDAY_TH).find((k) =>
    new RegExp(`วัน${k}`).test(text)
  );
  const en = Object.keys(WEEKDAY_EN).find((k) =>
    new RegExp(`\\b${k}\\b`, 'i').test(text)
  );

  if (thDay) {
    return {
      action: 'call_tool',
      toolName: 'get_timesheet',
      arguments: { date: bangkokMostRecentWeekday(WEEKDAY_TH[thDay]!, now) },
      reason: 'timesheet_day_intent',
    };
  }
  if (en) {
    return {
      action: 'call_tool',
      toolName: 'get_timesheet',
      arguments: { date: bangkokMostRecentWeekday(WEEKDAY_EN[en]!, now) },
      reason: 'timesheet_day_intent',
    };
  }

  // Day-ish intent without a resolvable date — never guess "today".
  if (DAY_RE.test(text)) {
    return {
      action: 'clarify',
      message:
        'Which date do you mean? Please include an explicit date (YYYY-MM-DD) or a relative day such as today or yesterday.',
      reason: 'unresolved_date_phrase',
    };
  }

  return null;
}

/**
 * Deterministic business-intent router.
 * Business topics must map to tools; general chit-chat returns none.
 */
export function decideBusinessTool(
  userMessage: string,
  options?: DecideBusinessToolOptions
): BusinessToolDecision {
  const text = userMessage.trim();
  if (!text) {
    return { action: 'none', reason: 'empty_message' };
  }

  const now = options?.now ?? new Date();

  if (
    GENERAL_ONLY_RE.test(text) &&
    !WORK_CONTEXT_RE.test(text) &&
    !DAY_RE.test(text) &&
    !RANGE_RE.test(text) &&
    !EXPLICIT_RANGE_RE.test(text)
  ) {
    return { action: 'none', reason: 'general_conversation' };
  }

  if (
    BARE_DAY_RE.test(text) &&
    extractIsoDates(text).length === 0 &&
    !/(เดือน|ปี|January|February|March|April|May|June|July|August|September|October|November|December)/i.test(
      text
    )
  ) {
    return {
      action: 'clarify',
      message:
        'Which date do you mean? Please include month and year (for example 2026-07-15).',
      reason: 'ambiguous_date',
    };
  }

  if (WORK_CONTEXT_RE.test(text)) {
    return {
      action: 'call_tool',
      toolName: 'get_work_context',
      arguments: {},
      reason: 'work_context_intent',
    };
  }

  // Explicit ISO ranges before single-date / relative range phrases.
  const explicitRange = resolveExplicitRange(text);
  if (explicitRange) {
    return explicitRange;
  }

  if (RANGE_RE.test(text)) {
    let range: { startDate: string; endDate: string };
    if (/(เดือนที่แล้ว|last\s+month)/i.test(text)) {
      range = bangkokLastMonth(now);
    } else if (/(เดือนนี้|this\s+month|monthly)/i.test(text)) {
      range = bangkokThisMonth(now);
    } else if (/(สัปดาห์ที่แล้ว|อาทิตย์ก่อน|last\s+week)/i.test(text)) {
      range = bangkokLastWeek(now);
    } else {
      range = bangkokCurrentWeek(now);
    }
    return {
      action: 'call_tool',
      toolName: 'get_timesheet_range',
      arguments: range,
      reason: 'timesheet_range_intent',
    };
  }

  const single = resolveSingleDay(text, now);
  if (single) {
    return single;
  }

  if (
    /(booking|employee\s+work|work\s+hour|logged\s+hour|ชั่วโมงทำงาน|งานของฉัน)/i.test(
      text
    )
  ) {
    return {
      action: 'call_tool',
      toolName: 'get_work_context',
      arguments: {},
      reason: 'business_topic_fallback_work_context',
    };
  }

  return { action: 'none', reason: 'no_business_intent' };
}

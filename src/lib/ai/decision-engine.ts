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

const ISO_DATE_GLOBAL_RE = /\b(\d{4}-\d{2}-\d{2})\b/g;
const BARE_DAY_RE = /วันที่\s*(\d{1,2})(?!\s*(เดือน|\/|-|\d))/i;

/** Explicit two-date range (Thai / English / hyphen). */
const EXPLICIT_RANGE_RE =
  /(?:จาก|ตั้งแต่|from|between)?\s*(\d{4}-\d{2}-\d{2})\s*(?:ถึง|to|and|-|–|—)\s*(\d{4}-\d{2}-\d{2})/i;

const RANGE_RE =
  /(สัปดาห์|อาทิตย์|เดือน|weekly|monthly|this\s+week|last\s+week|this\s+month|last\s+month|สรุป|summary|ชั่วโมง.*(สัปดาห์|เดือน|อาทิตย์)|hours?\s+(this|last)\s+(week|month))/i;

/** Personal-data signals (employee talking about their own work). */
const PERSONAL_RE =
  /\b(i|me|my|mine|am\s+i|do\s+i|did\s+i|i'?m|i\s+am)\b|ฉัน|ผม|ของฉัน|ของผม|ของตัวเอง|ได้รับมอบหมาย|รับผิดชอบ/i;

/** Explicit work-context / assignment phrasing (broad). */
const WORK_CONTEXT_RE =
  /\b(project|projects|client|clients|role|roles|assignment|assignments|assigned|responsibility|responsibilities|responsible\s+for|account|accounts|customer|customers|engagement|allocated\s+to|allocation|staffed\s+on|involved\s+in|working\s+on|work\s+on|current\s+work|my\s+work|my\s+team|work\s+context|เลือก\s*(project|client|role)|เปลี่ยน\s*(project|client|role)|which\s+(projects?|clients?|accounts?|roles?)|what\s+am\s+i\s+(currently\s+)?(working\s+on|assigned\s+to|responsible\s+for)|show\s+my\s+assignments|what\s+work\s+am\s+i)\b|ฉันมี\s*project|project\s*ที่|client\s*ของ|role\s*ของ|โปรเจกต์|โปรเจค|ลูกค้า|บทบาท|งานที่ได้รับมอบหมาย|ได้รับมอบหมาย|รับผิดชอบ|งานที่รับผิดชอบ|งานของฉัน|งานของผม|ตอนนี้ทำงานอะไร|กำลังทำงานอะไร|ดูแลงาน|ดูแลลูกค้า|อยู่โปรเจกต์ไหน|อยู่โปรเจคไหน|อยู่\s*account\s*ไหน|งานที่ทำอยู่|งานปัจจุบัน|ตอนนี้ฉันรับผิดชอบ|ฉันได้รับมอบหมาย|ตอนนี้ฉันทำงาน|ฉันดูแลงาน|ฉันอยู่\s*account/i;

const WORK_DOMAIN_RE =
  /\b(project|projects|client|clients|role|roles|assignment|assignments|assigned|responsibility|account|accounts|customer|engagement|allocation|staffed|working\s+on|my\s+work|booking)\b|โปรเจกต์|โปรเจค|ลูกค้า|บทบาท|มอบหมาย|รับผิดชอบ|ดูแลงาน|งานของ|account|งานปัจจุบัน/i;

/** Timesheet / hours domain (needs a period when no date is present). */
const TIMESHEET_DOMAIN_RE =
  /\b(timesheet|time\s*sheet|logged\s+hours?|hours?\s+did\s+i\s+log|how\s+many\s+hours|working\s+hours?|work\s+hours?|show\s+my\s+timesheet|my\s+timesheet)\b|ลงเวลา|timesheet|กี่ชั่วโมง|ดู\s*timesheet/i;

/**
 * Conceptual / educational questions — not the employee's data.
 */
const CONCEPTUAL_RE =
  /^(what\s+is\s+(a|an|the)\s+|what\s+does\s+(a|an|the)\s+|explain\s+|how\s+do\s+i\s+(write|code|program|implement|build)|how\s+does\s+(a|an|the)\s+|tell\s+me\s+about\s+(a|an|the)\s+|เล่าเรื่อง)/i;

/** "What is project management?" style definitions without an article. */
const CONCEPTUAL_WHAT_IS_RE = /^what\s+is\s+[a-z][\w\s-]{0,60}\??$/i;

const GREETING_THANKS_RE =
  /^(ขอบคุณ|thanks|thank\s*you|hello|hi|hey|สวัสดี|หวัดดี|good\s*(morning|afternoon|evening)|how\s+are\s+you)[\s!.?]*$/i;

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

function hasPersonalDataSignal(text: string): boolean {
  return PERSONAL_RE.test(text);
}

/**
 * Greetings, thanks, jokes/stories, programming help, and conceptual definitions.
 */
export function isClearlyGeneralConversation(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  if (GREETING_THANKS_RE.test(t)) return true;

  if (CONCEPTUAL_RE.test(t) || CONCEPTUAL_WHAT_IS_RE.test(t)) {
    // Personal override: "What am I working on?" / "What is my project?" are not conceptual.
    if (
      /\b(am\s+i|do\s+i|did\s+i|my|mine|assigned|ฉัน|ผม)\b/i.test(t)
    ) {
      return false;
    }
    return true;
  }

  if (
    /^(เล่าเรื่อง|tell\s+me\s+a\s+(joke|story)|joke\b)/i.test(t) &&
    !hasPersonalDataSignal(t)
  ) {
    return true;
  }

  if (
    /\b(typescript|javascript|python|microservice|microservices|architecture|programming)\b/i.test(
      t
    ) &&
    !hasPersonalDataSignal(t) &&
    !WORK_CONTEXT_RE.test(t)
  ) {
    return true;
  }

  return false;
}

/**
 * True when the message may ask about the current employee's ShopStack work data.
 * Fail-closed helper — not a mathematical guarantee of every NL phrasing.
 */
export function isPotentialBusinessIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (isClearlyGeneralConversation(text)) return false;

  if (EXPLICIT_RANGE_RE.test(text) || extractIsoDates(text).length > 0) {
    return true;
  }
  if (RANGE_RE.test(text)) return true;
  if (
    /(วันนี้|เมื่อวาน|พรุ่งนี้|tomorrow|today|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|วัน(จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์))/i.test(
      text
    )
  ) {
    return true;
  }
  if (BARE_DAY_RE.test(text)) return true;
  if (TIMESHEET_DOMAIN_RE.test(text)) return true;
  if (WORK_CONTEXT_RE.test(text)) return true;
  if (hasPersonalDataSignal(text) && WORK_DOMAIN_RE.test(text)) return true;
  if (
    hasPersonalDataSignal(text) &&
    /(ทำอะไร|ลงอะไร|logged|hours?)/i.test(text)
  ) {
    return true;
  }
  return false;
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

function resolveRelativeRange(
  text: string,
  now: Date
): BusinessToolDecision | null {
  if (!RANGE_RE.test(text)) return null;

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

function resolveSingleDay(
  text: string,
  now: Date
): BusinessToolDecision | null {
  const isos = extractIsoDates(text);
  if (isos.length >= 2) {
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
  if (
    /(วันนี้|today)/i.test(text) &&
    (TIMESHEET_DOMAIN_RE.test(text) ||
      /ทำอะไร|ลงอะไร|what\s+did\s+i|log/i.test(text))
  ) {
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

  return null;
}

function workContextDecision(reason: string): BusinessToolDecision {
  return {
    action: 'call_tool',
    toolName: 'get_work_context',
    arguments: {},
    reason,
  };
}

const MISSING_PERIOD_CLARIFY: BusinessToolDecision = {
  action: 'clarify',
  message: 'Which date or date range do you mean?',
  reason: 'missing_timesheet_period',
};

/**
 * Deterministic business-intent router (fail closed for potential employee-business asks).
 *
 * Recognized and potential employee-business intents are prevented from answering
 * directly and must route to a Business Tool or clarification.
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

  // Clearly general conversation
  if (isClearlyGeneralConversation(text)) {
    return { action: 'none', reason: 'general_conversation' };
  }

  // Ambiguous bare day without month/year
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

  // Explicit date range wins over project/client words in the same message
  const explicitRange = resolveExplicitRange(text);
  if (explicitRange) {
    return explicitRange;
  }

  // Relative range
  const relativeRange = resolveRelativeRange(text, now);
  if (relativeRange) {
    return relativeRange;
  }

  // Explicit or relative single date
  const single = resolveSingleDay(text, now);
  if (single) {
    return single;
  }

  // Work context / project / client / role / assignment
  if (WORK_CONTEXT_RE.test(text)) {
    return workContextDecision('potential_work_context_intent');
  }

  // Potential timesheet intent without a resolvable period → clarify
  if (TIMESHEET_DOMAIN_RE.test(text)) {
    return MISSING_PERIOD_CLARIFY;
  }

  // Personal logging ask without a date
  if (
    hasPersonalDataSignal(text) &&
    /(what\s+did\s+i\s+(do|log)|ทำอะไร|ลงอะไร|logged)/i.test(text)
  ) {
    return MISSING_PERIOD_CLARIFY;
  }

  // Potential employee-work intent → get_work_context
  if (isPotentialBusinessIntent(text)) {
    return workContextDecision('potential_work_context_intent');
  }

  return { action: 'none', reason: 'no_business_intent' };
}

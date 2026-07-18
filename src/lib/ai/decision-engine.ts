/**
 * Deterministic Decision Engine for Timesheet AI.
 *
 * Precedence (do not reorder lightly):
 * 1. Empty → none
 * 2. Clearly general conversation → none
 * 3. Ambiguous / invalid date → clarify
 * 4. Explicit ISO date range → get_timesheet_range
 * 5. Relative timesheet range → get_timesheet_range
 * 6. Explicit or relative single timesheet date → get_timesheet
 * 7. Explicit employee work-context request → get_work_context
 * 8. Timesheet request missing date/range → clarify
 * 9. Potential employee-business request → get_work_context / clarify
 * 10. Non-business → none
 *
 * Recognized and potential employee-business requests must route to a Business Tool
 * or clarification. Clearly general, conceptual, instructional, programming, news,
 * weather, and external-topic questions remain direct-answer requests.
 */

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

/**
 * Relative timesheet ranges — requires an actual week/month phrase.
 * Isolated "summary" / "สรุป" alone is NOT sufficient.
 */
const RELATIVE_RANGE_RE =
  /\b(this\s+week|last\s+week|this\s+month|last\s+month|weekly\s+timesheet|monthly\s+timesheet|hours?\s+this\s+week|hours?\s+last\s+week|summary\s+for\s+this\s+(week|month)|summarize\s+my\s+timesheet|weekly|monthly)\b|(สัปดาห์นี้|สัปดาห์ที่แล้ว|อาทิตย์นี้|อาทิตย์ที่แล้ว|อาทิตย์ก่อน|เดือนนี้|เดือนที่แล้ว|ชั่วโมงสัปดาห์นี้|สรุป\s*timesheet|สรุปเวลาของฉัน|สรุปสัปดาห์นี้)/i;

const GREETING_THANKS_RE =
  /^(ขอบคุณ|thanks|thank\s*you|hello|hi|hey|สวัสดี|หวัดดี|good\s*(morning|afternoon|evening)|how\s+are\s+you)[\s!.?]*$/i;

/** External / non-work subject matter (takes priority over bare date words). */
const EXTERNAL_TOPIC_RE =
  /\b(news|weather|rain|temperature|event|events|holiday|holidays|technology\s+news|market\s+news|sports?|match|game|calendar|current\s+affairs)\b|ข่าว|สภาพอากาศ|อากาศ|ฝน|อุณหภูมิ|เหตุการณ์|วันหยุด|กีฬา|การแข่งขัน|ปฏิทิน/i;

const PROGRAMMING_RE =
  /\b(code|coding|program|programming|implement|implementation|function|class|api|schema|database|sql|typescript|javascript|python|architecture|microservice|microservices|algorithm|unit\s+test|integration\s+test)\b/i;

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

function normalize(text: string): string {
  return text.trim();
}

/** Strong employee-specific work-context / assignment request structure. */
export function isWorkContextRequest(text: string): boolean {
  const t = normalize(text);
  return (
    /\b(which\s+(projects?|clients?|accounts?|roles?)\s+(am\s+i|do\s+i)|show\s+my\s+(assignments?|clients?|projects?|role|current\s+work|work\s+context)|who\s+are\s+my\s+clients|what\s+(is\s+)?my\s+role|what\s+am\s+i\s+(currently\s+)?(working\s+on|assigned\s+to|responsible\s+for)|what\s+work\s+am\s+i\s+responsible\s+for|which\s+accounts?\s+(do\s+i|am\s+i)|am\s+i\s+assigned|my\s+(projects?|clients?|assignments?|role|current\s+work)|เลือก\s*(project|client|role)|เปลี่ยน\s*(project|client|role))\b/i.test(
      t
    ) ||
    /(ฉันมี\s*(โปรเจกต์|โปรเจค|project)|ผมอยู่โปรเจค|ฉันอยู่\s*(โปรเจกต์|โปรเจค|account)|ฉันได้รับมอบหมาย|ผมได้รับมอบหมาย|ฉันรับผิดชอบ|ผมรับผิดชอบ|ฉันดูแล(งาน|ลูกค้า)|งานของฉัน|งานของผม|โปรเจกต์ของฉัน|โปรเจคของผม|ลูกค้าของฉัน|client\s*ของฉัน|role\s*ของฉัน|ตอนนี้ฉัน(รับผิดชอบ|ทำงาน)|ฉันดูแลงาน|เลือก\s*(project|client)|ฉันมี\s*project)/i.test(
      t
    )
  );
}

/** Employee timesheet / logged-hours request (may still need a period). */
export function isTimesheetDomainRequest(text: string): boolean {
  const t = normalize(text);
  return (
    /\b(timesheet|time\s*sheet|logged\s+hours?|how\s+many\s+hours\s+did\s+i|hours?\s+did\s+i\s+log|show\s+my\s+timesheet|my\s+timesheet|what\s+did\s+i\s+(do|log)|working\s+hours?\s+did\s+i)\b/i.test(
      t
    ) ||
    /(ลงเวลา|ดู\s*timesheet|timesheet\s*ของฉัน|กี่ชั่วโมง|วันนี้ฉันทำอะไร|เมื่อวานฉัน(ทำ|ลง)|พรุ่งนี้ฉัน)/i.test(
      t
    )
  );
}

/** Phrase-level employee-business request (not isolated pronouns). */
export function isEmployeeBusinessRequest(text: string): boolean {
  const t = normalize(text);
  if (isWorkContextRequest(t)) return true;
  if (isTimesheetDomainRequest(t)) return true;
  // Strong personal + work structure
  if (
    /\b(my\s+(projects?|clients?|role|assignments?|timesheet|logged\s+hours?|current\s+work)|am\s+i\s+assigned|do\s+i\s+manage|did\s+i\s+log|what\s+am\s+i\s+working\s+on|what\s+am\s+i\s+responsible\s+for|which\s+accounts?\s+am\s+i)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (
    /(โปรเจกต์ของฉัน|โปรเจคของผม|ลูกค้าของฉัน|role\s*ของฉัน|งานของฉัน|งานของผม|timesheet\s*ของฉัน|ฉันได้รับมอบหมาย|ผมได้รับมอบหมาย|ฉันรับผิดชอบ|ผมรับผิดชอบ|ฉันลงเวลา|ผมลงเวลา|ฉันอยู่โปรเจกต์ไหน|ผมอยู่\s*account)/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

export function isGeneralConceptualQuestion(text: string): boolean {
  const t = normalize(text);
  // Employee-specific overrides
  if (
    /\b(am\s+i|did\s+i|do\s+i\s+(manage|have)|my\s+(project|client|role|assignment|timesheet))\b/i.test(
      t
    ) ||
    /(ฉันมี|ผมอยู่|ของฉัน|ของผม|ฉันได้รับ|ฉันรับผิดชอบ)/i.test(t)
  ) {
    // Still allow pure definitions that happen to include "my" incorrectly — only block when clearly employee ask
    if (
      isWorkContextRequest(t) ||
      isTimesheetDomainRequest(t) ||
      /\b(what\s+am\s+i|which\s+.+\s+am\s+i|show\s+my)\b/i.test(t)
    ) {
      return false;
    }
  }

  if (
    /^(what\s+is\s+|what\s+are\s+|what\s+does\s+.+\s+do\b|how\s+does\s+.+\s+work\b|explain\s+|describe\s+|tell\s+me\s+about\s+|define\s+|what\s+is\s+the\s+difference\s+between\s+|what\s+day\s+is\s+today\b)/i.test(
      t
    )
  ) {
    return true;
  }

  // Thai conceptual
  if (
    /(คืออะไร|ทำหน้าที่อะไร|อธิบาย(การทำงาน|เรื่อง)|ความแตกต่างระหว่าง)/i.test(t) &&
    !/(ฉัน|ผม|ของฉัน|ของผม)/i.test(t)
  ) {
    return true;
  }

  return false;
}

export function isGeneralInstructionalQuestion(text: string): boolean {
  const t = normalize(text);
  // How do I / How should I / How can I — instructional, not employee data
  if (
    /^(how\s+do\s+i\s+|how\s+should\s+i\s+|how\s+can\s+i\s+|how\s+to\s+)/i.test(
      t
    )
  ) {
    // Exception: "How many hours did I log" is timesheet — handled by timesheet detector first in decide order
    // but this runs inside general check first — "How many hours did I log" must NOT be general
    if (/\bhow\s+many\s+hours\b/i.test(t) && /\bdid\s+i\s+log\b/i.test(t)) {
      return false;
    }
    return true;
  }

  if (
    /(บริหารโครงการอย่างไร|สร้าง\s*timesheet\s*อย่างไร|คำนวณชั่วโมงทำงานอย่างไร|เขียน\s*typescript\s*อย่างไร|สรุปข้อมูลรายสัปดาห์อย่างไร)/i.test(
      t
    )
  ) {
    return true;
  }

  return false;
}

export function isGeneralNewsOrExternalTopic(text: string): boolean {
  const t = normalize(text);
  if (EXTERNAL_TOPIC_RE.test(t)) return true;
  if (
    /\b(what\s+happened\s+yesterday|will\s+it\s+rain|what\s+events\s+are\s+happening)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (/(เมื่อวานมีข่าว|พรุ่งนี้ฝน|อากาศวันนี้|วันนี้มีเหตุการณ์|เดือนนี้มีวันหยุด)/i.test(t)) {
    return true;
  }
  // Bare summary of news/external without employee timesheet structure
  if (
    /^(summarize|summary|สรุป)/i.test(t) &&
    EXTERNAL_TOPIC_RE.test(t)
  ) {
    return true;
  }
  if (/^สรุปข่าว/i.test(t)) return true;
  if (/^summarize\s+(today'?s\s+)?news/i.test(t)) return true;
  if (/^tell\s+me\s+about\s+yesterday'?s\s+news/i.test(t)) return true;
  return false;
}

function isGeneralComparisonQuestion(text: string): boolean {
  const t = normalize(text);
  return (
    /^(compare\s+|pros\s+and\s+cons\b|what\s+is\s+the\s+difference\s+between\b)/i.test(
      t
    ) ||
    /(เปรียบเทียบ|ข้อดีข้อเสีย|ต่างกันอย่างไร)/i.test(t)
  );
}

function isGeneralProgrammingQuestion(text: string): boolean {
  const t = normalize(text);
  if (!PROGRAMMING_RE.test(t) && !/(เขียนโค้ด|ออกแบบ\s*.*api|database\s*schema)/i.test(t)) {
    return false;
  }
  // Employee data ask overrides
  if (isWorkContextRequest(t) || /\bshow\s+my\b/i.test(t)) return false;
  return true;
}

function isBareUnqualifiedSummary(text: string): boolean {
  const t = normalize(text);
  if (/^(summarize\s+this|สรุปให้หน่อย)[\s!.?]*$/i.test(t)) return true;
  // "summary" / "สรุป" alone without week/month/timesheet/employee structure
  if (
    /^(summary|summarize|สรุป)([\s!.?]*)$/i.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * General conversation: greetings, conceptual, instructional, news/weather,
 * programming, comparisons. Runs before date/work routing.
 */
export function isClearlyGeneralConversation(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;

  if (GREETING_THANKS_RE.test(t)) return true;
  if (/^(เล่าเรื่อง|tell\s+me\s+a\s+(joke|story)|joke\b)/i.test(t)) {
    // Stories/jokes — not employee data asks
    if (!isWorkContextRequest(t) && !isTimesheetDomainRequest(t)) return true;
  }
  if (isBareUnqualifiedSummary(t)) return true;
  if (isGeneralNewsOrExternalTopic(t)) return true;
  if (isGeneralConceptualQuestion(t)) return true;
  if (isGeneralInstructionalQuestion(t)) return true;
  if (isGeneralComparisonQuestion(t)) return true;
  if (isGeneralProgrammingQuestion(t)) return true;

  return false;
}

/**
 * Potential employee-business after more specific detectors failed.
 * Must not treat bare relative dates or domain keywords alone as work-context.
 */
export function isPotentialBusinessIntent(message: string): boolean {
  const text = normalize(message);
  if (!text) return false;
  if (isClearlyGeneralConversation(text)) return false;
  return isEmployeeBusinessRequest(text);
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
  if (!RELATIVE_RANGE_RE.test(text)) return null;

  let range: { startDate: string; endDate: string };
  if (/(เดือนที่แล้ว|last\s+month)/i.test(text)) {
    range = bangkokLastMonth(now);
  } else if (/(เดือนนี้|this\s+month|monthly)/i.test(text)) {
    range = bangkokThisMonth(now);
  } else if (/(สัปดาห์ที่แล้ว|อาทิตย์ก่อน|อาทิตย์ที่แล้ว|last\s+week)/i.test(text)) {
    range = bangkokLastWeek(now);
  } else {
    // this week / สัปดาห์นี้ / weekly / summary for this week / สรุปสัปดาห์นี้
    range = bangkokCurrentWeek(now);
  }

  return {
    action: 'call_tool',
    toolName: 'get_timesheet_range',
    arguments: range,
    reason: 'timesheet_range_intent',
  };
}

/**
 * Single calendar day → get_timesheet.
 * Standalone today/yesterday/tomorrow (EN/TH) are sufficient after general-check.
 */
function resolveSingleDay(
  text: string,
  now: Date
): BusinessToolDecision | null {
  const t = normalize(text);
  const isos = extractIsoDates(t);

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

  // Standalone or embedded relative days (general news/weather already filtered out).
  // Note: \b does not work reliably with Thai script — match Thai literals directly.
  if (/\btomorrow\b/i.test(t) || t.includes('พรุ่งนี้')) {
    return {
      action: 'call_tool',
      toolName: 'get_timesheet',
      arguments: { date: bangkokTomorrow(now) },
      reason: 'timesheet_day_intent',
    };
  }

  if (/\byesterday\b/i.test(t) || t.includes('เมื่อวาน')) {
    return {
      action: 'call_tool',
      toolName: 'get_timesheet',
      arguments: { date: bangkokYesterday(now) },
      reason: 'timesheet_day_intent',
    };
  }

  if (/\btoday\b/i.test(t) || t.includes('วันนี้')) {
    return {
      action: 'call_tool',
      toolName: 'get_timesheet',
      arguments: { date: bangkokToday(now) },
      reason: 'timesheet_day_intent',
    };
  }

  const thDay = Object.keys(WEEKDAY_TH).find((k) =>
    new RegExp(`วัน${k}`).test(t)
  );
  const en = Object.keys(WEEKDAY_EN).find((k) =>
    new RegExp(`\\b${k}\\b`, 'i').test(t)
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
 * Deterministic business-intent router.
 */
export function decideBusinessTool(
  userMessage: string,
  options?: DecideBusinessToolOptions
): BusinessToolDecision {
  const text = normalize(userMessage);
  if (!text) {
    return { action: 'none', reason: 'empty_message' };
  }

  const now = options?.now ?? new Date();

  // 2. Clearly general — before any date / work keyword routing
  if (isClearlyGeneralConversation(text)) {
    return { action: 'none', reason: 'general_conversation' };
  }

  // 3. Ambiguous bare day without month/year
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

  // 4. Explicit ISO date range (wins over project words)
  const explicitRange = resolveExplicitRange(text);
  if (explicitRange) {
    return explicitRange;
  }

  // 5. Relative timesheet range (week/month phrases only)
  const relativeRange = resolveRelativeRange(text, now);
  if (relativeRange) {
    return relativeRange;
  }

  // 6. Explicit or relative single date (including standalone today / วันนี้)
  const single = resolveSingleDay(text, now);
  if (single) {
    return single;
  }

  // 7. Explicit employee work-context request
  if (isWorkContextRequest(text)) {
    return workContextDecision('potential_work_context_intent');
  }

  // 8. Timesheet domain without a resolvable period → clarify (never default today/week)
  if (isTimesheetDomainRequest(text)) {
    return MISSING_PERIOD_CLARIFY;
  }

  // 9. Potential employee-business request
  if (isPotentialBusinessIntent(text)) {
    return workContextDecision('potential_work_context_intent');
  }

  // 10. Non-business
  return { action: 'none', reason: 'no_business_intent' };
}

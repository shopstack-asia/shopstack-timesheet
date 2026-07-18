import {
  bangkokCurrentWeek,
  bangkokLastMonth,
  bangkokLastWeek,
  bangkokThisMonth,
  bangkokToday,
  bangkokYesterday,
  bangkokMostRecentWeekday,
} from '@/lib/tools/business/timesheet/bangkok-dates';

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
  /(วันนี้|เมื่อวาน|tomorrow|today|yesterday|what\s+did\s+i\s+(do|log)|ทำอะไร|ลงอะไร|logged|timesheet|วัน(จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;

const ISO_DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;
const BARE_DAY_RE = /วันที่\s*(\d{1,2})(?!\s*(เดือน|\/|-|\d))/i;

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

  // General conversation fallback (greeting / thanks / joke / story)
  if (GENERAL_ONLY_RE.test(text) && !WORK_CONTEXT_RE.test(text) && !DAY_RE.test(text) && !RANGE_RE.test(text)) {
    return { action: 'none', reason: 'general_conversation' };
  }

  // Ambiguous bare calendar day without month/year
  if (BARE_DAY_RE.test(text) && !ISO_DATE_RE.test(text) && !/(เดือน|ปี|January|February|March|April|May|June|July|August|September|October|November|December)/i.test(text)) {
    return {
      action: 'clarify',
      message:
        'Which date do you mean? Please include month and year (for example 2026-07-15).',
      reason: 'ambiguous_date',
    };
  }

  // Priority 1: work context
  if (WORK_CONTEXT_RE.test(text)) {
    return {
      action: 'call_tool',
      toolName: 'get_work_context',
      arguments: {},
      reason: 'work_context_intent',
    };
  }

  // Priority 2a: date range
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

  // Priority 2b: single date
  if (DAY_RE.test(text) || ISO_DATE_RE.test(text)) {
    const iso = text.match(ISO_DATE_RE)?.[1];
    let date: string;
    if (iso) {
      date = iso;
    } else if (/(เมื่อวาน|yesterday)/i.test(text)) {
      date = bangkokYesterday(now);
    } else if (/(วันนี้|today)/i.test(text)) {
      date = bangkokToday(now);
    } else {
      const th = Object.keys(WEEKDAY_TH).find((k) => text.includes(k));
      const en = Object.keys(WEEKDAY_EN).find((k) =>
        new RegExp(`\\b${k}\\b`, 'i').test(text)
      );
      if (th) {
        date = bangkokMostRecentWeekday(WEEKDAY_TH[th]!, now);
      } else if (en) {
        date = bangkokMostRecentWeekday(WEEKDAY_EN[en]!, now);
      } else {
        date = bangkokToday(now);
      }
    }
    return {
      action: 'call_tool',
      toolName: 'get_timesheet',
      arguments: { date },
      reason: 'timesheet_day_intent',
    };
  }

  // Booking / employee work / hours without clearer shape → prefer work context
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

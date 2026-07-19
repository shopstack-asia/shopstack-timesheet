import {
  bangkokToday,
  bangkokTomorrow,
  bangkokYesterday,
  bangkokCurrentWeek,
  bangkokLastWeek,
  bangkokThisMonth,
  bangkokLastMonth,
} from '@/lib/tools/business/timesheet/bangkok-dates';

const THAI_NUM: Record<string, number> = {
  ศูนย์: 0,
  หนึ่ง: 1,
  สอง: 2,
  สาม: 3,
  สี่: 4,
  ห้า: 5,
  หก: 6,
  เจ็ด: 7,
  แปด: 8,
  เก้า: 9,
  สิบ: 10,
};

/**
 * Resolve a natural date expression to Asia/Bangkok YYYY-MM-DD.
 */
export function resolveDateExpression(
  expression: string | null | undefined,
  now: Date = new Date()
): string | undefined {
  if (!expression?.trim()) return undefined;
  const t = expression.trim();

  const iso = t.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (iso) {
    if (!isValidIsoDate(iso[1]!)) return undefined;
    return iso[1];
  }

  const lower = t.toLowerCase();
  if (
    lower === 'today' ||
    t === 'วันนี้' ||
    t.includes('วันนี้') ||
    lower.includes('today')
  ) {
    return bangkokToday(now);
  }
  if (
    lower === 'yesterday' ||
    t === 'เมื่อวาน' ||
    t.includes('เมื่อวาน') ||
    lower.includes('yesterday')
  ) {
    return bangkokYesterday(now);
  }
  if (
    lower === 'tomorrow' ||
    t === 'พรุ่งนี้' ||
    t.includes('พรุ่งนี้') ||
    lower.includes('tomorrow')
  ) {
    return bangkokTomorrow(now);
  }

  return undefined;
}

export function resolveRangeExpressions(
  start: string | null | undefined,
  end: string | null | undefined,
  now: Date = new Date()
): { startDate: string; endDate: string } | undefined {
  const combined = `${start || ''} ${end || ''}`.toLowerCase();
  if (
    combined.includes('this week') ||
    combined.includes('สัปดาห์นี้') ||
    (start || '').includes('สัปดาห์นี้')
  ) {
    return bangkokCurrentWeek(now);
  }
  if (
    combined.includes('last week') ||
    combined.includes('สัปดาห์ที่แล้ว')
  ) {
    return bangkokLastWeek(now);
  }
  if (combined.includes('this month') || combined.includes('เดือนนี้')) {
    return bangkokThisMonth(now);
  }
  if (
    combined.includes('last month') ||
    combined.includes('เดือนที่แล้ว')
  ) {
    return bangkokLastMonth(now);
  }

  const startDate = resolveDateExpression(start, now);
  const endDate = resolveDateExpression(end, now);
  if (startDate && endDate) {
    if (startDate > endDate) return undefined;
    return { startDate, endDate };
  }
  return undefined;
}

export function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m! - 1 &&
    dt.getUTCDate() === d
  );
}

export function parseHoursValue(
  hours: number | null | undefined,
  fromText?: string
): number | undefined {
  if (typeof hours === 'number' && Number.isFinite(hours) && hours > 0 && hours <= 24) {
    return hours;
  }
  if (!fromText) return undefined;
  const m =
    fromText.match(/(\d+(?:\.\d+)?)\s*(?:ชั่วโมง|ชม\.?|hours?|hrs?)/i) ||
    fromText.match(/(?:สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\s*(?:ชั่วโมง|ชม)/);
  if (m?.[1] && /^\d/.test(m[1])) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 && n <= 24 ? n : undefined;
  }
  for (const [word, n] of Object.entries(THAI_NUM)) {
    if (fromText.includes(word) && /(ชั่วโมง|ชม)/.test(fromText)) {
      return n > 0 && n <= 24 ? n : undefined;
    }
  }
  return undefined;
}

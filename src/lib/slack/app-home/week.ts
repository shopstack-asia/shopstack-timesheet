/**
 * Bangkok calendar helpers for App Home week display.
 * Reuses Asia/Bangkok arithmetic from business timesheet dates.
 */

import {
  addCalendarDays,
  formatBangkokDate,
  weekRangeContaining,
} from '@/lib/tools/business/timesheet/bangkok-dates';

const TH_WEEKDAY_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'] as const;

const TH_MONTH_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

const TH_MONTH_FULL = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

function parseIsoParts(isoDate: string): {
  y: number;
  m: number;
  d: number;
  weekday: number;
} {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  return { y: y!, m: m!, d: d!, weekday: utc.getUTCDay() };
}

/** Monday–Sunday week containing Bangkok today, with all seven dates. */
export function bangkokMondaySundayWeek(now: Date = new Date()): {
  today: string;
  startDate: string;
  endDate: string;
  dates: string[];
} {
  const today = formatBangkokDate(now);
  const { startDate, endDate } = weekRangeContaining(today);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    dates.push(addCalendarDays(startDate, i));
  }
  return { today, startDate, endDate, dates };
}

export function thaiWeekdayShort(isoDate: string): string {
  return TH_WEEKDAY_SHORT[parseIsoParts(isoDate).weekday]!;
}

/** e.g. 13 ก.ค. */
export function thaiDayMonthShort(isoDate: string): string {
  const { m, d } = parseIsoParts(isoDate);
  return `${d} ${TH_MONTH_SHORT[m - 1]}`;
}

/** e.g. 13–19 กรกฎาคม 2026 or 28 ก.ค.–3 ส.ค. 2026 */
export function thaiWeekRangeLabel(startDate: string, endDate: string): string {
  const a = parseIsoParts(startDate);
  const b = parseIsoParts(endDate);
  if (a.y === b.y && a.m === b.m) {
    return `${a.d}–${b.d} ${TH_MONTH_FULL[a.m - 1]} ${a.y}`;
  }
  if (a.y === b.y) {
    return `${a.d} ${TH_MONTH_SHORT[a.m - 1]}–${b.d} ${TH_MONTH_SHORT[b.m - 1]} ${a.y}`;
  }
  return `${a.d} ${TH_MONTH_SHORT[a.m - 1]} ${a.y}–${b.d} ${TH_MONTH_SHORT[b.m - 1]} ${b.y}`;
}

/** Format hours without inventing expected totals. */
export function formatHoursDisplay(hours: number): string {
  if (!Number.isFinite(hours)) return '0';
  const rounded = Math.round(hours * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

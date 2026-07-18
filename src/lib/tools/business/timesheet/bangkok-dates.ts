import { TIMESHEET_TIMEZONE } from '@/lib/tools/business/types';

/** Format a Date as YYYY-MM-DD in Asia/Bangkok. */
export function formatBangkokDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMESHEET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addCalendarDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d! + deltaDays));
  const yyyy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Monday–Sunday week containing `isoDate` (ISO week style, Monday start). */
export function weekRangeContaining(isoDate: string): {
  startDate: string;
  endDate: string;
} {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  const day = utc.getUTCDay(); // 0 Sun .. 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const startDate = addCalendarDays(isoDate, mondayOffset);
  const endDate = addCalendarDays(startDate, 6);
  return { startDate, endDate };
}

export function bangkokToday(now: Date = new Date()): string {
  return formatBangkokDate(now);
}

export function bangkokYesterday(now: Date = new Date()): string {
  return addCalendarDays(formatBangkokDate(now), -1);
}

export function bangkokCurrentWeek(now: Date = new Date()): {
  startDate: string;
  endDate: string;
} {
  const today = formatBangkokDate(now);
  const { startDate } = weekRangeContaining(today);
  return { startDate, endDate: today };
}

export function bangkokLastWeek(now: Date = new Date()): {
  startDate: string;
  endDate: string;
} {
  const today = formatBangkokDate(now);
  const thisWeek = weekRangeContaining(today);
  const endDate = addCalendarDays(thisWeek.startDate, -1);
  const startDate = addCalendarDays(endDate, -6);
  return { startDate, endDate };
}

export function bangkokThisMonth(now: Date = new Date()): {
  startDate: string;
  endDate: string;
} {
  const today = formatBangkokDate(now);
  const startDate = `${today.slice(0, 7)}-01`;
  return { startDate, endDate: today };
}

export function bangkokLastMonth(now: Date = new Date()): {
  startDate: string;
  endDate: string;
} {
  const today = formatBangkokDate(now);
  const [y, m] = today.split('-').map(Number);
  const prevMonth = m === 1 ? 12 : m! - 1;
  const prevYear = m === 1 ? y! - 1 : y!;
  const startDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const endDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

/**
 * Most recent occurrence of weekday (0=Sun … 6=Sat) on or before Bangkok today.
 * If today is that weekday, returns today.
 */
export function bangkokMostRecentWeekday(
  weekday: number,
  now: Date = new Date()
): string {
  const today = formatBangkokDate(now);
  const [y, m, d] = today.split('-').map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  const current = utc.getUTCDay();
  const delta = (current - weekday + 7) % 7;
  return addCalendarDays(today, -delta);
}

export { addCalendarDays };

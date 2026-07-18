/**
 * Date parsing for Timesheet Agent using TIMESHEET_AGENT_TIMEZONE.
 */

export function getAgentTimeZone(): string {
  return process.env.TIMESHEET_AGENT_TIMEZONE?.trim() || 'Asia/Bangkok';
}

/** YYYY-MM-DD in agent timezone */
export function zonedYmd(timeZone: string, date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return { y, m: mo, d };
}

export function isValidYmd(ymd: string): boolean {
  return parseYmd(ymd) !== null;
}

export function addDaysYmd(ymd: string, delta: number): string {
  const p = parseYmd(ymd);
  if (!p) throw new Error('Invalid date');
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + delta));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Monday on or before ymd (weekStartsOn: 1) */
export function weekStartMonday(ymd: string): string {
  const p = parseYmd(ymd);
  if (!p) throw new Error('Invalid date');
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const dow = dt.getUTCDay(); // 0 Sun .. 6 Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDaysYmd(ymd, offset);
}

export type DateResolveResult =
  | { ok: true; date: string; isFuture: boolean }
  | { ok: false; error: string };

export function resolveDateText(
  text: string,
  timeZone: string = getAgentTimeZone(),
  now: Date = new Date()
): DateResolveResult {
  const raw = text.trim().toLowerCase();
  const today = zonedYmd(timeZone, now);

  if (!raw) {
    return { ok: false, error: 'Missing date' };
  }

  if (raw === 'today' || raw === 'วันนี้') {
    return { ok: true, date: today, isFuture: false };
  }
  if (raw === 'yesterday' || raw === 'เมื่อวาน' || raw === 'เมื่อวานนี้') {
    return { ok: true, date: addDaysYmd(today, -1), isFuture: false };
  }
  if (raw === 'tomorrow' || raw === 'พรุ่งนี้') {
    const d = addDaysYmd(today, 1);
    return { ok: true, date: d, isFuture: true };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    if (!isValidYmd(raw)) return { ok: false, error: 'Invalid calendar date' };
    return { ok: true, date: raw, isFuture: raw > today };
  }

  // this monday / last friday
  if (raw === 'this monday' || raw === 'monday this week') {
    const d = weekStartMonday(today);
    return { ok: true, date: d, isFuture: d > today };
  }
  if (raw === 'last friday' || raw === 'friday last week') {
    const thisMon = weekStartMonday(today);
    const lastFri = addDaysYmd(thisMon, -3);
    return { ok: true, date: lastFri, isFuture: false };
  }
  if (raw === 'this friday') {
    const thisMon = weekStartMonday(today);
    const fri = addDaysYmd(thisMon, 4);
    return { ok: true, date: fri, isFuture: fri > today };
  }

  // 14 Jul 2026 / Jul 14, 2026
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    const ymd = zonedYmd(timeZone, new Date(parsed));
    if (!isValidYmd(ymd)) return { ok: false, error: 'Invalid calendar date' };
    return { ok: true, date: ymd, isFuture: ymd > today };
  }

  return { ok: false, error: `Could not understand date: ${text}` };
}

export function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

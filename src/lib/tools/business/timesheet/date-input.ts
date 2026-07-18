import { ToolError } from '@/lib/tools/errors';
import { MAX_TIMESHEET_RANGE_DAYS } from '@/lib/tools/business/types';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const RELATIVE_DATE_RE =
  /^(today|yesterday|tomorrow|this\s+week|last\s+week|this\s+month|last\s+month|วันนี้|เมื่อวาน|พรุ่งนี้|สัปดาห์นี้|สัปดาห์ที่แล้ว|เดือนนี้|เดือนที่แล้ว)$/i;

/** True when `iso` is YYYY-MM-DD and a real Gregorian calendar day. */
export function isValidCalendarDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** Require YYYY-MM-DD; reject relative NL strings. */
export function parseRequiredIsoDate(
  value: unknown,
  fieldName: string
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolError(
      `${fieldName} is required and must be YYYY-MM-DD`,
      'validation_error'
    );
  }
  const trimmed = value.trim();
  if (RELATIVE_DATE_RE.test(trimmed)) {
    throw new ToolError(
      `${fieldName} must be an explicit YYYY-MM-DD date; resolve relative phrases (e.g. today/yesterday) in the AI layer before calling the tool`,
      'validation_error'
    );
  }
  if (!ISO_DATE_RE.test(trimmed) || !isValidCalendarDate(trimmed)) {
    throw new ToolError(
      `${fieldName} must be a valid calendar date in YYYY-MM-DD format`,
      'validation_error'
    );
  }
  return trimmed;
}

function toUtcDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

/** Inclusive calendar-day count between ISO dates. */
export function inclusiveDayCount(startDate: string, endDate: string): number {
  const ms = toUtcDay(endDate) - toUtcDay(startDate);
  return Math.floor(ms / 86_400_000) + 1;
}

export function assertValidDateRange(
  startDate: string,
  endDate: string
): void {
  if (toUtcDay(startDate) > toUtcDay(endDate)) {
    throw new ToolError(
      'startDate must not be after endDate',
      'validation_error'
    );
  }
  const days = inclusiveDayCount(startDate, endDate);
  if (days > MAX_TIMESHEET_RANGE_DAYS) {
    throw new ToolError(
      `Date range must be at most ${MAX_TIMESHEET_RANGE_DAYS} calendar days (got ${days})`,
      'validation_error'
    );
  }
}

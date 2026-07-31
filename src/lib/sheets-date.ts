/**
 * Google Sheets date serial helpers.
 *
 * Sheets stores dates as day counts from 1899-12-30 (Lotus 1-2-3 epoch).
 * Serial 60 is the fictitious 1900-02-29; conversions here are correct for
 * calendar dates on or after 1900-03-01 (all real timesheet data).
 */

const SHEETS_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function utcYmdFromMs(ms: number): string {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Convert YYYY-MM-DD to a Google Sheets date serial (integer day).
 */
export function isoDateToSerial(iso: string): number | null {
  const trimmed = iso.trim();
  if (!ISO_DATE_RE.test(trimmed)) {
    return null;
  }
  const [y, m, d] = trimmed.split('-').map((p) => Number(p));
  if (
    !Number.isInteger(y) ||
    !Number.isInteger(m) ||
    !Number.isInteger(d) ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > 31
  ) {
    return null;
  }
  const utcMs = Date.UTC(y, m - 1, d);
  // Reject impossible calendar dates (e.g. 2026-02-30 overflows to March).
  if (utcYmdFromMs(utcMs) !== trimmed) {
    return null;
  }
  return Math.round((utcMs - SHEETS_EPOCH_UTC_MS) / MS_PER_DAY);
}

/**
 * Convert a Google Sheets date serial to YYYY-MM-DD.
 * Fractional serials (date+time) are truncated to the calendar day.
 */
export function serialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial)) {
    return null;
  }
  const daySerial = Math.floor(serial);
  // Serials before 1900-03-01 collide with the Lotus leap-year fiction.
  if (daySerial < 61) {
    return null;
  }
  const utcMs = SHEETS_EPOCH_UTC_MS + daySerial * MS_PER_DAY;
  return utcYmdFromMs(utcMs);
}

/**
 * Normalize a Time Log Date cell (UNFORMATTED_VALUE serial, ISO text, or legacy text)
 * to YYYY-MM-DD for app-layer comparisons.
 */
export function normalizeSheetDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return serialToIsoDate(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (ISO_DATE_RE.test(trimmed)) {
      return trimmed;
    }
    // Numeric string from Sheets / mixed migration rows
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return serialToIsoDate(Number(trimmed));
    }
    return null;
  }

  return null;
}

/**
 * Value to write into Time Log column B with valueInputOption RAW.
 * Prefer a date serial; fall back to the original ISO string if conversion fails.
 */
export function dateCellForSheetsWrite(isoDate: string): number | string {
  const serial = isoDateToSerial(isoDate);
  return serial === null ? isoDate : serial;
}

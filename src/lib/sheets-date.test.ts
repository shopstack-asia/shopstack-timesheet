import { describe, expect, it } from 'vitest';
import {
  dateCellForSheetsWrite,
  isoDateToSerial,
  normalizeSheetDate,
  serialToIsoDate,
} from '@/lib/sheets-date';

describe('isoDateToSerial / serialToIsoDate', () => {
  it('round-trips known ISO dates', () => {
    for (const iso of ['2024-01-01', '2026-07-20', '2026-07-31', '1900-03-01']) {
      const serial = isoDateToSerial(iso);
      expect(serial).not.toBeNull();
      expect(serialToIsoDate(serial!)).toBe(iso);
    }
  });

  it('maps 2024-01-01 to Sheets serial 45292', () => {
    expect(isoDateToSerial('2024-01-01')).toBe(45292);
  });

  it('maps 2026-07-20 to Sheets serial 46223', () => {
    expect(isoDateToSerial('2026-07-20')).toBe(46223);
  });

  it('rejects invalid ISO and impossible calendar dates', () => {
    expect(isoDateToSerial('')).toBeNull();
    expect(isoDateToSerial('2026/07/20')).toBeNull();
    expect(isoDateToSerial('2026-02-30')).toBeNull();
    expect(isoDateToSerial('not-a-date')).toBeNull();
  });

  it('rejects Lotus leap-year fiction serials below 61', () => {
    expect(serialToIsoDate(60)).toBeNull();
    expect(serialToIsoDate(0)).toBeNull();
    expect(serialToIsoDate(NaN)).toBeNull();
  });

  it('truncates fractional serials to the calendar day', () => {
    expect(serialToIsoDate(46223.75)).toBe('2026-07-20');
  });
});

describe('normalizeSheetDate', () => {
  it('accepts Sheets serial numbers', () => {
    expect(normalizeSheetDate(46223)).toBe('2026-07-20');
  });

  it('accepts ISO text (legacy / formatted)', () => {
    expect(normalizeSheetDate('2026-07-20')).toBe('2026-07-20');
    expect(normalizeSheetDate(' 2026-07-20 ')).toBe('2026-07-20');
  });

  it('accepts numeric strings from mixed migration rows', () => {
    expect(normalizeSheetDate('46223')).toBe('2026-07-20');
  });

  it('rejects ambiguous slash dates and empty values', () => {
    expect(normalizeSheetDate('7/20/2026')).toBeNull();
    expect(normalizeSheetDate('20/07/2026')).toBeNull();
    expect(normalizeSheetDate(null)).toBeNull();
    expect(normalizeSheetDate(undefined)).toBeNull();
    expect(normalizeSheetDate('')).toBeNull();
  });
});

describe('dateCellForSheetsWrite', () => {
  it('writes a serial for valid ISO dates', () => {
    expect(dateCellForSheetsWrite('2026-07-20')).toBe(46223);
  });

  it('falls back to the original string when conversion fails', () => {
    expect(dateCellForSheetsWrite('bad')).toBe('bad');
  });
});

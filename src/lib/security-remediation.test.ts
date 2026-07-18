import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { assertCronAuth, timingSafeEqualString } from '@/lib/cron-auth';
import { sanitizeSheetCellValue } from '@/lib/sheets-sanitize';
import { getConfiguredAppBaseUrl } from '@/lib/app-url';

describe('cron-auth fail closed', () => {
  const prev = process.env.CRON_SECRET;

  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });

  it('rejects when CRON_SECRET missing', () => {
    delete process.env.CRON_SECRET;
    const req = new NextRequest('http://localhost/api/cron/x', {
      headers: { authorization: 'Bearer anything' },
    });
    const res = assertCronAuth(req);
    expect(res?.status).toBe(401);
  });

  it('rejects empty bearer token', () => {
    process.env.CRON_SECRET = 'super-secret-value';
    const req = new NextRequest('http://localhost/api/cron/x', {
      headers: { authorization: 'Bearer ' },
    });
    expect(assertCronAuth(req)?.status).toBe(401);
  });

  it('rejects missing authorization', () => {
    process.env.CRON_SECRET = 'super-secret-value';
    const req = new NextRequest('http://localhost/api/cron/x');
    expect(assertCronAuth(req)?.status).toBe(401);
  });

  it('accepts matching bearer token', () => {
    process.env.CRON_SECRET = 'super-secret-value';
    const req = new NextRequest('http://localhost/api/cron/x', {
      headers: { authorization: 'Bearer super-secret-value' },
    });
    expect(assertCronAuth(req)).toBeNull();
  });

  it('timingSafeEqualString matches equals only', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true);
    expect(timingSafeEqualString('abc', 'abd')).toBe(false);
  });
});

describe('sheets formula sanitization', () => {
  it('neutralizes formula prefixes', () => {
    expect(sanitizeSheetCellValue('=1+1')).toBe("'=1+1");
    expect(sanitizeSheetCellValue('+cmd')).toBe("'+cmd");
    expect(sanitizeSheetCellValue('-1')).toBe("'-1");
    expect(sanitizeSheetCellValue('@sum')).toBe("'@sum");
    expect(sanitizeSheetCellValue('Normal')).toBe('Normal');
  });
});

describe('app url fail closed', () => {
  const keys = ['NEXT_PUBLIC_APP_URL', 'APP_URL', 'NEXTAUTH_URL'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('throws when unset', () => {
    for (const k of keys) delete process.env[k];
    expect(() => getConfiguredAppBaseUrl()).toThrow(/not configured/i);
  });

  it('returns origin from NEXT_PUBLIC_APP_URL', () => {
    for (const k of keys) delete process.env[k];
    process.env.NEXT_PUBLIC_APP_URL = 'https://timesheet.example.com/path';
    expect(getConfiguredAppBaseUrl()).toBe('https://timesheet.example.com');
  });
});

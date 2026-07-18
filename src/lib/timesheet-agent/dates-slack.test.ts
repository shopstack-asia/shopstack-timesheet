import { describe, expect, it } from 'vitest';
import {
  addDaysYmd,
  isValidYmd,
  resolveDateText,
  weekStartMonday,
} from '@/lib/timesheet-agent/dates';
import { verifySlackSignature } from '@/lib/slack/client';
import crypto from 'crypto';

describe('dates', () => {
  it('validates calendar dates', () => {
    expect(isValidYmd('2026-07-14')).toBe(true);
    expect(isValidYmd('2026-13-40')).toBe(false);
  });

  it('week starts monday', () => {
    // 2026-07-15 is Wednesday
    expect(weekStartMonday('2026-07-15')).toBe('2026-07-13');
  });

  it('resolves yesterday relative to fixed now', () => {
    const now = new Date('2026-07-15T12:00:00+07:00');
    const r = resolveDateText('yesterday', 'Asia/Bangkok', now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.date).toBe(addDaysYmd('2026-07-15', -1));
  });
});

describe('slack signature', () => {
  it('validates good signature', () => {
    const secret = 'test_secret';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"url_verification"}';
    const base = `v0:${timestamp}:${body}`;
    const sig =
      'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
    expect(verifySlackSignature(secret, sig, timestamp, body)).toBe(true);
  });

  it('rejects bad signature', () => {
    expect(
      verifySlackSignature('secret', 'v0=deadbeef', String(Math.floor(Date.now() / 1000)), '{}')
    ).toBe(false);
  });
});

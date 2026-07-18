import { describe, expect, it } from 'vitest';
import { ackFlagsFromPresentedCodes } from '@/lib/timesheet-agent/guardrails';
import { dayFingerprint } from '@/lib/timesheet-agent/verify';

/**
 * Pending-write acknowledgment binding (unit-level).
 * Execute path merges presentedPolicyCodes + leaveOverride from pending only.
 */
describe('pending acknowledgment binding', () => {
  it('correct acknowledgment from presented codes + leave override', () => {
    const acks = ackFlagsFromPresentedCodes(
      ['HOLIDAY_ACK_REQUIRED', 'OVER_24_ACK_REQUIRED'],
      { leaveOverride: true }
    );
    expect(acks).toEqual({
      leaveOverride: true,
      holidayAcknowledged: true,
      futureAcknowledged: undefined,
      over24Acknowledged: true,
    });
  });

  it('missing acknowledgment when code not presented', () => {
    const acks = ackFlagsFromPresentedCodes(['FUTURE_ACK_REQUIRED']);
    expect(acks.holidayAcknowledged).toBeUndefined();
    expect(acks.leaveOverride).toBeUndefined();
    expect(acks.futureAcknowledged).toBe(true);
  });

  it('stale payload fingerprint detection', () => {
    const original = [{ projectId: '1', taskId: '1', hours: 4 }];
    const changed = [{ projectId: '1', taskId: '1', hours: 8 }];
    expect(dayFingerprint(original)).not.toBe(dayFingerprint(changed));
  });

  it('confirmation without prior warning', () => {
    const acks = ackFlagsFromPresentedCodes([]);
    expect(acks.holidayAcknowledged).toBeUndefined();
    expect(acks.futureAcknowledged).toBeUndefined();
    expect(acks.over24Acknowledged).toBeUndefined();
    expect(acks.leaveOverride).toBeUndefined();
  });
});

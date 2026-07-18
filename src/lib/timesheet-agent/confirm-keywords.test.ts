import { describe, expect, it } from 'vitest';
import {
  matchConfirmKeyword,
  textSatisfiesRequiredKeyword,
} from '@/lib/timesheet-agent/confirm-keywords';

describe('deterministic confirmation', () => {
  it('accepts YES aliases only', () => {
    expect(matchConfirmKeyword('YES')).toBe('YES');
    expect(matchConfirmKeyword('yes')).toBe('YES');
    expect(matchConfirmKeyword('ยืนยัน')).toBe('YES');
  });

  it('accepts CLEAR and OVERRIDE exactly', () => {
    expect(matchConfirmKeyword('CLEAR')).toBe('CLEAR');
    expect(matchConfirmKeyword('OVERRIDE')).toBe('OVERRIDE');
  });

  it('rejects soft confirm language', () => {
    for (const t of [
      'looks good',
      'probably',
      'go ahead maybe',
      'save later',
      'random text classified by the model as confirm',
    ]) {
      expect(matchConfirmKeyword(t)).toBeNull();
      expect(textSatisfiesRequiredKeyword(t, 'YES')).toBe(false);
      expect(textSatisfiesRequiredKeyword(t, 'CLEAR')).toBe(false);
    }
  });

  it('YES does not satisfy CLEAR requirement', () => {
    expect(textSatisfiesRequiredKeyword('YES', 'CLEAR')).toBe(false);
    expect(textSatisfiesRequiredKeyword('CLEAR', 'CLEAR')).toBe(true);
  });
});

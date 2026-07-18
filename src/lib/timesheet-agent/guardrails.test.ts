import { describe, expect, it } from 'vitest';
import {
  evaluateClearGuards,
  evaluateWriteGuards,
  validateEntryHours,
} from '@/lib/timesheet-agent/guardrails';
import { entriesToDaySet } from '@/lib/timesheet-agent/merge';
import { LeaveDayEntry, Holiday } from '@/types';

describe('guardrails', () => {
  it('invalid hours', () => {
    expect(validateEntryHours(0)).toBeTruthy();
    expect(validateEntryHours(25)).toBeTruthy();
    expect(validateEntryHours(4)).toBeNull();
  });

  it('total over 24 requires ack', () => {
    const daySet = entriesToDaySet([
      { projectId: '1', taskId: '1', hours: 20 },
      { projectId: '2', taskId: '1', hours: 6 },
    ]);
    const r = evaluateWriteGuards({
      date: '2026-07-14',
      daySet,
      leave: [],
      holidays: [],
      isFuture: false,
    });
    expect(r.ok).toBe(false);
  });

  it('future date requires ack', () => {
    const r = evaluateWriteGuards({
      date: '2099-01-01',
      daySet: entriesToDaySet([{ projectId: '1', taskId: '1', hours: 1 }]),
      leave: [],
      holidays: [],
      isFuture: true,
    });
    expect(r.ok).toBe(false);
    expect(r.requireKeyword).toBe('YES');
  });

  it('full leave blocks without override', () => {
    const leave: LeaveDayEntry[] = [
      {
        date: '2026-07-14',
        type: 'FULL',
        dayType: 'FULL_DAY',
        leaveType: 'Annual',
        reason: '',
        status: 'Approved',
      },
    ];
    const r = evaluateWriteGuards({
      date: '2026-07-14',
      daySet: entriesToDaySet([{ projectId: '1', taskId: '1', hours: 1 }]),
      leave,
      holidays: [],
      isFuture: false,
    });
    expect(r.ok).toBe(false);
    expect(r.requireKeyword).toBe('OVERRIDE');
  });

  it('holiday warns', () => {
    const holidays: Holiday[] = [
      {
        id: '1',
        name: 'Test Day',
        date: '2026-07-14',
        is_holiday: true,
      },
    ];
    const r = evaluateWriteGuards({
      date: '2026-07-14',
      daySet: entriesToDaySet([{ projectId: '1', taskId: '1', hours: 1 }]),
      leave: [],
      holidays,
      isFuture: false,
    });
    expect(r.ok).toBe(false);
  });

  it('custom project disabled', () => {
    const r = evaluateWriteGuards({
      date: '2026-07-14',
      daySet: entriesToDaySet([{ projectId: 'NewThing', taskId: '1', hours: 1 }]),
      leave: [],
      holidays: [],
      isFuture: false,
      createCustomProject: true,
    });
    expect(r.ok).toBe(false);
    expect(r.blockMessage).toMatch(/not available/i);
  });

  it('clear requires CLEAR', () => {
    const r = evaluateClearGuards(true);
    expect(r.requireKeyword).toBe('CLEAR');
  });
});

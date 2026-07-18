import { Holiday, LeaveDayEntry } from '@/types';
import { DaySet, dayTotal } from '@/lib/timesheet-agent/merge';
import { getLeaveEntry, isFullLeave, isHalfLeave } from '@/lib/leave-utils';

export type WriteGuardContext = {
  date: string;
  daySet: DaySet;
  leave: LeaveDayEntry[] | null; // null = failed to load
  holidays: Holiday[] | null;
  isFuture: boolean;
  createCustomProject?: boolean;
  leaveOverride?: boolean;
  holidayAcknowledged?: boolean;
  futureAcknowledged?: boolean;
  over24Acknowledged?: boolean;
};

export type GuardResult = {
  ok: boolean;
  blockMessage?: string;
  warnings: string[];
  requireKeyword?: 'OVERRIDE' | 'CLEAR' | 'CREATE PROJECT' | 'YES';
};

export function validateEntryHours(hours: number): string | null {
  if (!(hours > 0)) return 'Hours must be greater than 0';
  if (hours > 24) return 'Hours must be at most 24 per entry';
  return null;
}

export function evaluateWriteGuards(ctx: WriteGuardContext): GuardResult {
  const warnings: string[] = [];

  for (const e of ctx.daySet.values()) {
    const err = validateEntryHours(e.hours);
    if (err) {
      return { ok: false, blockMessage: err, warnings };
    }
  }

  const total = dayTotal(ctx.daySet);
  if (total > 24) {
    warnings.push(`Day total is ${total.toFixed(2)} hours (over 24).`);
    if (!ctx.over24Acknowledged) {
      return {
        ok: false,
        blockMessage: `Day total exceeds 24 hours (${total.toFixed(2)}). Confirm you still want to save.`,
        warnings,
        requireKeyword: 'YES',
      };
    }
  }

  if (ctx.leave === null) {
    warnings.push('Leave data could not be loaded.');
    if (!ctx.leaveOverride && !ctx.holidayAcknowledged) {
      // require explicit continue via confirmation warnings
      warnings.push('Reply YES on confirmation to proceed without leave context.');
    }
  } else {
    const leave = getLeaveEntry(ctx.date, ctx.leave);
    if (leave && isFullLeave(ctx.date, ctx.leave)) {
      const msg = `Full-day leave on ${ctx.date}: ${leave.leaveType || 'Leave'} (status: ${leave.status || 'n/a'}).`;
      if (!ctx.leaveOverride) {
        return {
          ok: false,
          blockMessage: `${msg} Say OVERRIDE to save hours anyway.`,
          warnings: [...warnings, msg],
          requireKeyword: 'OVERRIDE',
        };
      }
      warnings.push(`${msg} OVERRIDE accepted.`);
    } else if (leave && isHalfLeave(ctx.date, ctx.leave)) {
      warnings.push(
        `Half-day leave on ${ctx.date}: ${leave.leaveType || 'Leave'} (${leave.dayType}, status: ${leave.status || 'n/a'}).`
      );
    }
  }

  if (ctx.holidays === null) {
    warnings.push('Holiday data could not be loaded.');
  } else {
    const holiday = ctx.holidays.find((h) => h.date === ctx.date);
    if (holiday && (holiday.is_holiday ?? true)) {
      const msg = `Holiday on ${ctx.date}: ${holiday.name}.`;
      warnings.push(msg);
      if (!ctx.holidayAcknowledged) {
        return {
          ok: false,
          blockMessage: `${msg} Confirm to save anyway.`,
          warnings,
          requireKeyword: 'YES',
        };
      }
    }
  }

  if (ctx.isFuture && !ctx.futureAcknowledged) {
    return {
      ok: false,
      blockMessage: `${ctx.date} is a future date. Confirm to save anyway.`,
      warnings: [...warnings, 'Future date'],
      requireKeyword: 'YES',
    };
  }

  if (ctx.createCustomProject) {
    return {
      ok: false,
      blockMessage:
        'This will CREATE a shared *New project in Google Sheets. Type CREATE PROJECT to continue.',
      warnings: [...warnings, 'Custom project creation'],
      requireKeyword: 'CREATE PROJECT',
    };
  }

  return { ok: true, warnings };
}

export function evaluateClearGuards(hasEntries: boolean): GuardResult {
  if (!hasEntries) {
    return { ok: true, warnings: ['Day is already empty.'] };
  }
  return {
    ok: false,
    blockMessage: 'This deletes ALL entries for that date. Type CLEAR to confirm.',
    warnings: ['Clear day'],
    requireKeyword: 'CLEAR',
  };
}

import type { PolicyCode } from '@/lib/timesheet-agent/guardrails';

export type WeekDaySubmitInput = {
  date: string;
  entries: Array<{
    projectId: string;
    taskId: string;
    hours: number;
  }>;
  leaveOverride?: boolean;
  holidayAcknowledged?: boolean;
  futureAcknowledged?: boolean;
  over24Acknowledged?: boolean;
};

export type DaySubmitResult = {
  date: string;
  success: boolean;
  error?: string;
  policyCode?: PolicyCode;
};

export type PostDaySubmit = (
  day: WeekDaySubmitInput
) => Promise<{
  success: boolean;
  error?: string;
  policyCode?: PolicyCode;
}>;

export type ConfirmPolicyFn = (
  date: string,
  policyCode: PolicyCode,
  message: string
) => Promise<boolean>;

const POLICY_ACK_KEYS: Record<
  string,
  keyof Pick<
    WeekDaySubmitInput,
    | 'leaveOverride'
    | 'holidayAcknowledged'
    | 'futureAcknowledged'
    | 'over24Acknowledged'
  >
> = {
  LEAVE_OVERRIDE_REQUIRED: 'leaveOverride',
  HOLIDAY_ACK_REQUIRED: 'holidayAcknowledged',
  FUTURE_ACK_REQUIRED: 'futureAcknowledged',
  OVER_24_ACK_REQUIRED: 'over24Acknowledged',
};

export function ackFlagForPolicyCode(
  code: PolicyCode
):
  | 'leaveOverride'
  | 'holidayAcknowledged'
  | 'futureAcknowledged'
  | 'over24Acknowledged'
  | null {
  const key = POLICY_ACK_KEYS[code];
  return key ?? null;
}

/**
 * Submit each day with entries one-by-one (one click → sequential POSTs).
 * Continues through remaining days if one fails; caller aggregates failures.
 *
 * Does NOT auto-set acknowledgment flags. When the server returns a policyCode,
 * asks `confirmPolicy` and retries with only that flag if the user confirms.
 */
export async function submitWeekDaysSequentially(
  days: WeekDaySubmitInput[],
  postDay: PostDaySubmit,
  confirmPolicy?: ConfirmPolicyFn
): Promise<DaySubmitResult[]> {
  const daysWithEntries = days.filter((day) => day.entries.length > 0);
  const results: DaySubmitResult[] = [];

  for (const day of daysWithEntries) {
    try {
      const result = await submitDayWithExplicitPolicyAcks(day, postDay, confirmPolicy);
      results.push(result);
    } catch (error) {
      results.push({
        date: day.date,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to submit day',
      });
    }
  }

  return results;
}

export async function submitDayWithExplicitPolicyAcks(
  day: WeekDaySubmitInput,
  postDay: PostDaySubmit,
  confirmPolicy?: ConfirmPolicyFn
): Promise<DaySubmitResult> {
  // Start with whatever explicit acks the caller provided (normally none)
  const acks: WeekDaySubmitInput = {
    date: day.date,
    entries: day.entries,
    leaveOverride: day.leaveOverride,
    holidayAcknowledged: day.holidayAcknowledged,
    futureAcknowledged: day.futureAcknowledged,
    over24Acknowledged: day.over24Acknowledged,
  };

  for (let attempt = 0; attempt < 6; attempt++) {
    const result = await postDay(acks);
    if (result.success) {
      return { date: day.date, success: true };
    }

    const code = result.policyCode;
    const ackKey = code ? ackFlagForPolicyCode(code) : null;
    if (!code || !ackKey) {
      return {
        date: day.date,
        success: false,
        error: result.error,
        policyCode: code,
      };
    }

    if (!confirmPolicy) {
      return {
        date: day.date,
        success: false,
        error: result.error,
        policyCode: code,
      };
    }

    const accepted = await confirmPolicy(
      day.date,
      code,
      result.error || `Confirm ${code} for ${day.date}?`
    );
    if (!accepted) {
      return {
        date: day.date,
        success: false,
        error: 'Cancelled policy confirmation',
        policyCode: code,
      };
    }

    if (ackKey === 'leaveOverride') acks.leaveOverride = true;
    else if (ackKey === 'holidayAcknowledged') acks.holidayAcknowledged = true;
    else if (ackKey === 'futureAcknowledged') acks.futureAcknowledged = true;
    else if (ackKey === 'over24Acknowledged') acks.over24Acknowledged = true;
  }

  return {
    date: day.date,
    success: false,
    error: 'Too many policy confirmations required',
  };
}

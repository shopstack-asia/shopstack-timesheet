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
};

export type PostDaySubmit = (
  day: WeekDaySubmitInput
) => Promise<{ success: boolean; error?: string }>;

/**
 * Submit each day with entries one-by-one (one click → sequential POSTs).
 * Continues through remaining days if one fails; caller aggregates failures.
 */
export async function submitWeekDaysSequentially(
  days: WeekDaySubmitInput[],
  postDay: PostDaySubmit
): Promise<DaySubmitResult[]> {
  const daysWithEntries = days.filter((day) => day.entries.length > 0);
  const results: DaySubmitResult[] = [];

  for (const day of daysWithEntries) {
    try {
      const result = await postDay(day);
      results.push({
        date: day.date,
        success: result.success,
        error: result.error,
      });
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

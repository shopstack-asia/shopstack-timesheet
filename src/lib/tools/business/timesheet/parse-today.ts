import {
  DEFAULT_EXPECTED_DAY_HOURS,
  type TodayTimesheet,
} from '@/lib/tools/business/types';
import { parseDailyTimesheet } from '@/lib/tools/business/timesheet/parse-timesheet';

/** @deprecated Use parseDailyTimesheet from parse-timesheet.ts */
export function parseTodayTimesheet(data: unknown): TodayTimesheet {
  return parseDailyTimesheet(data);
}

export { DEFAULT_EXPECTED_DAY_HOURS };

import { format, startOfWeek, endOfWeek, addDays } from 'date-fns';

/**
 * Get the Monday–Sunday dates for a given week
 */
export function getWeekDates(date: Date): Date[] {
  const monday = startOfWeek(date, { weekStartsOn: 1 });
  const dates: Date[] = [];

  for (let i = 0; i < 7; i++) {
    dates.push(addDays(monday, i));
  }

  return dates;
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDateISO(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Check if a date is a weekday (Monday-Friday)
 */
export function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}


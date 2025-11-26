import { LeaveDayEntry } from '@/types';

const STORAGE_KEY_PREFIX = 'leave_data';
const STORAGE_VERSION = 'v1';

interface StoredLeaveData {
  version: string;
  employeeId: string;
  year: number;
  data: LeaveDayEntry[];
  timestamp: number;
}

/**
 * Get storage key for leave data
 */
function getStorageKey(employeeId: string, year: number): string {
  return `${STORAGE_KEY_PREFIX}:${STORAGE_VERSION}:${employeeId}:${year}`;
}

/**
 * Get all stored leave data keys for an employee
 */
function getAllStorageKeys(employeeId: string): string[] {
  const keys: string[] = [];
  if (typeof window === 'undefined') {
    return keys;
  }

  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(`${STORAGE_KEY_PREFIX}:${STORAGE_VERSION}:${employeeId}:`)) {
      keys.push(key);
    }
  }

  return keys;
}

/**
 * Store yearly leave data in localStorage
 */
export function storeYearlyLeaveData(
  employeeId: string,
  year: number,
  data: LeaveDayEntry[]
): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const stored: StoredLeaveData = {
      version: STORAGE_VERSION,
      employeeId,
      year,
      data,
      timestamp: Date.now(),
    };

    const key = getStorageKey(employeeId, year);
    window.localStorage.setItem(key, JSON.stringify(stored));
  } catch (error) {
    console.error('[LeaveStorage] Failed to store leave data:', error);
  }
}

/**
 * Get yearly leave data from localStorage
 */
export function getYearlyLeaveData(
  employeeId: string,
  year: number
): LeaveDayEntry[] | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const key = getStorageKey(employeeId, year);
    const stored = window.localStorage.getItem(key);

    if (!stored) {
      return null;
    }

    const parsed: StoredLeaveData = JSON.parse(stored);

    // Validate stored data
    if (
      parsed.version !== STORAGE_VERSION ||
      parsed.employeeId !== employeeId ||
      parsed.year !== year ||
      !Array.isArray(parsed.data)
    ) {
      // Invalid data, remove it
      window.localStorage.removeItem(key);
      return null;
    }

    return parsed.data;
  } catch (error) {
    console.error('[LeaveStorage] Failed to get leave data:', error);
    return null;
  }
}

/**
 * Get all leave data for multiple years from localStorage
 */
export function getAllLeaveData(employeeId: string, years: number[]): LeaveDayEntry[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const allData: LeaveDayEntry[] = [];

  for (const year of years) {
    const data = getYearlyLeaveData(employeeId, year);
    if (data) {
      allData.push(...data);
    }
  }

  return allData;
}

/**
 * Clear all leave data for an employee
 */
export function clearLeaveData(employeeId: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const keys = getAllStorageKeys(employeeId);
    keys.forEach((key) => {
      window.localStorage.removeItem(key);
    });
  } catch (error) {
    console.error('[LeaveStorage] Failed to clear leave data:', error);
  }
}

/**
 * Check if yearly leave data exists in localStorage
 */
export function hasYearlyLeaveData(employeeId: string, year: number): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const key = getStorageKey(employeeId, year);
  return window.localStorage.getItem(key) !== null;
}


import { getYearlyHolidays } from '@/lib/zoho/getYearlyHolidays';
import { getRedisClient, type RedisAdapter } from '@/lib/redis';
import { getZohoPeopleService } from '@/lib/zoho-people';
import { Holiday } from '@/types';

const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60; // 1 year in seconds
const MAX_RETRIES = 3; // Maximum number of retry attempts
const RETRY_DELAY_MS = 1000; // Delay between retries in milliseconds

/** Holiday dependency cannot be trusted — never treat as empty list */
export class HolidayUnavailableError extends Error {
  constructor(message = 'Holiday data is temporarily unavailable') {
    super(message);
    this.name = 'HolidayUnavailableError';
  }
}

type HolidayRedis = Pick<RedisAdapter, 'get' | 'setex' | 'del'>;

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  delayMs: number = RETRY_DELAY_MS
): Promise<T> {
  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const backoffDelay = delayMs * Math.pow(2, attempt - 1); // Exponential backoff
        console.warn(
          `[Holiday Cache] Attempt ${attempt}/${maxRetries} failed, retrying in ${backoffDelay}ms...`,
          error instanceof Error ? error.message : String(error)
        );
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      } else {
        console.error(
          `[Holiday Cache] All ${maxRetries} attempts failed`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  throw lastError;
}

/**
 * Get all unique locations from employees
 */
async function getAllLocations(): Promise<string[]> {
  const zohoService = getZohoPeopleService();
  const employees = await zohoService.getAllEmployees();

  // Extract unique locations
  const locations = new Set<string>();
  employees.forEach((emp) => {
    if (emp.Location && emp.Location.trim()) {
      locations.add(emp.Location.trim());
    }
  });

  // Also include default location from env if set
  const defaultLocation =
    process.env.ZOHO_DEFAULT_LOCATION ||
    process.env.NEXT_PUBLIC_ZOHO_HOLIDAY_LOCATION ||
    process.env.NEXT_PUBLIC_DEFAULT_LOCATION;

  if (defaultLocation && defaultLocation.trim()) {
    locations.add(defaultLocation.trim());
  }

  return Array.from(locations);
}

function envDefaultLocation(): string {
  return (
    process.env.ZOHO_DEFAULT_LOCATION ||
    process.env.NEXT_PUBLIC_ZOHO_HOLIDAY_LOCATION ||
    process.env.NEXT_PUBLIC_DEFAULT_LOCATION ||
    ''
  ).trim();
}

/**
 * Fetch and cache holidays for all locations and years (previous, current, next)
 * Fetches holidays separately for each location to ensure all locations are included
 * Retries until successful or max retries reached
 *
 * Always writes the Redis key (including `[]`) so readers can distinguish
 * "no holidays" from "cache miss / unavailable".
 */
export async function refreshHolidayCache(): Promise<void> {
  try {
    // Get all locations from employees
    const locations = await getAllLocations();

    if (locations.length === 0) {
      console.warn('[Holiday Cache] No locations found, skipping refresh');
      return;
    }

    const currentYear = new Date().getFullYear();
    const years = [currentYear - 1, currentYear, currentYear + 1];

    const redis = getRedisClient();
    const fetchPromises: Promise<void>[] = [];
    const defaultLoc = envDefaultLocation();

    // Clean up old keys (holiday:${year} format) before refreshing
    try {
      for (const year of years) {
        const oldKey = `holiday:${year}`;
        try {
          const oldData = await redis.get(oldKey);
          if (oldData) {
            await redis.del(oldKey);
          }
        } catch (error) {
          console.warn(`[Holiday Cache] Error deleting old key "${oldKey}":`, error);
        }
      }
    } catch (error) {
      console.warn('[Holiday Cache] Error cleaning up old keys (continuing anyway):', error);
    }

    // Fetch holidays for each location and year combination
    for (const location of locations) {
      for (const year of years) {
        const fetchPromise = (async () => {
          // Retry until successful or max retries reached
          await retryWithBackoff(async () => {
            const holidays = await getYearlyHolidays({ location, year });

            // Store holidays for this location and year (including empty = trusted none)
            const cacheKey = `holiday:${location}:${year}`;
            await redis.setex(
              cacheKey,
              ONE_YEAR_IN_SECONDS,
              JSON.stringify(holidays)
            );

            // Mirror env-default location under holiday:default:{year}
            if (defaultLoc && location === defaultLoc) {
              await redis.setex(
                `holiday:default:${year}`,
                ONE_YEAR_IN_SECONDS,
                JSON.stringify(holidays)
              );
            }
          });
        })();

        fetchPromises.push(fetchPromise);
      }
    }

    // Wait for all fetches to complete
    // Use allSettled to continue even if some years fail after retries
    const results = await Promise.allSettled(fetchPromises);

    // Check if any failed after all retries
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      const errorMessages = failures
        .map((f) => (f.status === 'rejected' ? String(f.reason) : ''))
        .filter(Boolean);
      console.error(
        `[Holiday Cache] Failed to refresh holidays for ${failures.length} location/year combination(s) after ${MAX_RETRIES} retries:`,
        errorMessages
      );
      // Still throw error to indicate partial failure
      throw new Error(
        `Failed to refresh holiday cache for ${failures.length} location/year combination(s): ${errorMessages.join('; ')}`
      );
    }
  } catch (error) {
    console.error('[Holiday Cache] Error refreshing holiday cache:', error);
    throw error;
  }
}

/** Validate Redis payload is a trusted holiday list (empty array = no holidays). */
export function parseTrustedHolidayList(raw: unknown, cacheKey: string): Holiday[] {
  if (raw === null || raw === undefined) {
    throw new HolidayUnavailableError(`Holiday cache miss: ${cacheKey}`);
  }
  if (!Array.isArray(raw)) {
    throw new HolidayUnavailableError(`Holiday cache corrupt: ${cacheKey}`);
  }
  for (const item of raw) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as Holiday).date !== 'string'
    ) {
      throw new HolidayUnavailableError(`Holiday cache corrupt: ${cacheKey}`);
    }
  }
  return raw as Holiday[];
}

/**
 * Get holidays from Redis cache for a specific location and year.
 *
 * Three outcomes:
 * - Success with holidays
 * - Success with [] (trusted: cache present, no holidays)
 * - Throws HolidayUnavailableError (miss, Redis error, corruption)
 *
 * Never returns [] to mean "unavailable".
 */
export async function getCachedHolidays(
  location: string | undefined,
  year: number,
  deps?: { redis?: HolidayRedis }
): Promise<Holiday[]> {
  const redis = deps?.redis ?? getRedisClient();
  const trimmed = location?.trim();

  try {
    const result: Holiday[] = [];

    if (trimmed) {
      const locationCacheKey = `holiday:${trimmed}:${year}`;
      const locationHolidays = await redis.get<unknown>(locationCacheKey);
      result.push(...parseTrustedHolidayList(locationHolidays, locationCacheKey));

      // Optional supplemental default list (miss = skip; corrupt/error = fail)
      const defaultCacheKey = `holiday:default:${year}`;
      try {
        const defaultHolidays = await redis.get<unknown>(defaultCacheKey);
        if (defaultHolidays !== null && defaultHolidays !== undefined) {
          result.push(...parseTrustedHolidayList(defaultHolidays, defaultCacheKey));
        }
      } catch (error) {
        if (error instanceof HolidayUnavailableError) {
          throw error;
        }
        console.error(
          `[Holiday Cache] Failed to read default holidays for ${defaultCacheKey}:`,
          error
        );
        throw new HolidayUnavailableError();
      }
    } else {
      const defaultCacheKey = `holiday:default:${year}`;
      const defaultHolidays = await redis.get<unknown>(defaultCacheKey);
      result.push(...parseTrustedHolidayList(defaultHolidays, defaultCacheKey));
    }

    return result;
  } catch (error) {
    if (error instanceof HolidayUnavailableError) {
      throw error;
    }
    const cacheKey = trimmed
      ? `holiday:${trimmed}:${year}`
      : `holiday:default:${year}`;
    console.error(`[Holiday Cache] Failed to read from Redis for ${cacheKey}:`, error);
    throw new HolidayUnavailableError();
  }
}

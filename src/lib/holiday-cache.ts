/**
 * Holiday cache — Redis cache-aside over Zoho yearly holidays.
 *
 * Cache miss / expiry / malformed → reload from Zoho → populate Redis → return.
 * Never treat a missing key as an empty holiday list.
 * Canonical Zoho failure → HolidayUnavailableError (fail closed).
 */

import {
  getYearlyHolidays,
  ZohoHolidayParseError,
  isStrictCalendarIsoDate,
} from '@/lib/zoho/getYearlyHolidays';
import { getRedisClient, type RedisAdapter } from '@/lib/redis';
import { getZohoPeopleService } from '@/lib/zoho-people';
import { Holiday } from '@/types';
import { z } from 'zod';

export const HOLIDAY_CACHE_SCHEMA_VERSION = 1 as const;
/** ~1 year — expiry triggers cache-aside reload, not permanent loss of holidays. */
export const HOLIDAY_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;
export const HOLIDAY_REFRESH_LOCK_TTL_SECONDS = 30;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const REFRESH_WAIT_ATTEMPTS = 8;
const REFRESH_WAIT_MS = 250;

export type HolidayCacheOutcome =
  | 'hit'
  | 'miss'
  | 'invalid'
  | 'read_failed'
  | 'refreshed'
  | 'write_failed';

export type HolidayCanonicalOutcome =
  | 'not_called'
  | 'success'
  | 'empty_success'
  | 'failed'
  | 'invalid';

export type HolidayDependencyCode =
  | 'holiday_source_unavailable'
  | 'holiday_data_invalid'
  | 'redis_unavailable';

/** Holiday dependency cannot be trusted — never treat as empty list */
export class HolidayUnavailableError extends Error {
  readonly code: HolidayDependencyCode;
  readonly requestedYear?: number;
  readonly cacheOutcome?: HolidayCacheOutcome;
  readonly canonicalOutcome?: HolidayCanonicalOutcome;

  constructor(
    message = 'Holiday data is temporarily unavailable',
    options?: {
      code?: HolidayDependencyCode;
      requestedYear?: number;
      cacheOutcome?: HolidayCacheOutcome;
      canonicalOutcome?: HolidayCanonicalOutcome;
    }
  ) {
    super(message);
    this.name = 'HolidayUnavailableError';
    this.code = options?.code ?? 'holiday_source_unavailable';
    this.requestedYear = options?.requestedYear;
    this.cacheOutcome = options?.cacheOutcome;
    this.canonicalOutcome = options?.canonicalOutcome;
  }
}

export type HolidayCacheEnvelope = {
  schemaVersion: typeof HOLIDAY_CACHE_SCHEMA_VERSION;
  scope: string;
  year: number;
  loadedAt: string;
  source: 'zoho';
  holidays: Holiday[];
};

const HolidayItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift_name: z.string().optional(),
  location_name: z.string().optional(),
  remarks: z.string().optional(),
  is_holiday: z.boolean(),
});

const HolidayCacheEnvelopeSchema = z.object({
  schemaVersion: z.literal(HOLIDAY_CACHE_SCHEMA_VERSION),
  scope: z.string().min(1),
  year: z.number().int().min(2000),
  loadedAt: z.string().min(1),
  source: z.literal('zoho'),
  holidays: z.array(HolidayItemSchema),
});

type HolidayRedis = Pick<RedisAdapter, 'get' | 'setex' | 'del' | 'setNx'>;

export type GetHolidaysDeps = {
  redis?: HolidayRedis;
  loadCanonical?: (input: {
    location?: string;
    year: number;
  }) => Promise<Holiday[]>;
  requestId?: string;
  /** Skip waiting on refresh lock (tests). */
  skipRefreshWait?: boolean;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

function logHoliday(payload: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      scope: 'holiday-cache',
      level: 'info',
      ts: new Date().toISOString(),
      dependency: 'holiday',
      ...payload,
    })
  );
}

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
        const backoffDelay = delayMs * Math.pow(2, attempt - 1);
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

async function getAllLocations(): Promise<string[]> {
  const zohoService = getZohoPeopleService();
  const employees = await zohoService.getAllEmployees();

  const locations = new Set<string>();
  employees.forEach((emp) => {
    if (emp.Location && emp.Location.trim()) {
      locations.add(emp.Location.trim());
    }
  });

  const defaultLocation = envDefaultLocation();
  if (defaultLocation) {
    locations.add(defaultLocation);
  }

  return Array.from(locations);
}

export function envDefaultLocation(): string {
  return (
    process.env.ZOHO_DEFAULT_LOCATION ||
    process.env.NEXT_PUBLIC_ZOHO_HOLIDAY_LOCATION ||
    process.env.NEXT_PUBLIC_DEFAULT_LOCATION ||
    ''
  ).trim();
}

/**
 * `default` in holiday:default:{year} means the env-default location mirror
 * (ZOHO_DEFAULT_LOCATION / NEXT_PUBLIC_ZOHO_HOLIDAY_LOCATION / NEXT_PUBLIC_DEFAULT_LOCATION),
 * also used when staff Location is empty.
 */
export function holidayCacheKey(scope: string, year: number): string {
  return `holiday:${scope}:${year}`;
}

export function holidayRefreshLockKey(scope: string, year: number): string {
  return `holiday:refresh-lock:${scope}:${year}`;
}

export function buildHolidayCacheEnvelope(input: {
  scope: string;
  year: number;
  holidays: Holiday[];
  loadedAt?: string;
}): HolidayCacheEnvelope {
  return {
    schemaVersion: HOLIDAY_CACHE_SCHEMA_VERSION,
    scope: input.scope,
    year: input.year,
    loadedAt: input.loadedAt ?? new Date().toISOString(),
    source: 'zoho',
    holidays: input.holidays,
  };
}

/**
 * Parse Redis payload: versioned envelope or legacy raw Holiday[].
 * Null/undefined → miss (caller must not treat as empty list).
 */
export function parseHolidayCachePayload(
  raw: unknown,
  expected: { scope: string; year: number; cacheKey: string }
): { holidays: Holiday[]; legacy: boolean } {
  if (raw === null || raw === undefined) {
    throw new HolidayUnavailableError(`Holiday cache miss: ${expected.cacheKey}`, {
      code: 'holiday_source_unavailable',
      requestedYear: expected.year,
      cacheOutcome: 'miss',
      canonicalOutcome: 'not_called',
    });
  }

  if (Array.isArray(raw)) {
    const holidays = parseTrustedHolidayList(raw, expected.cacheKey);
    return { holidays, legacy: true };
  }

  if (typeof raw === 'object') {
    const parsed = HolidayCacheEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HolidayUnavailableError(
        `Holiday cache corrupt: ${expected.cacheKey}`,
        {
          code: 'holiday_data_invalid',
          requestedYear: expected.year,
          cacheOutcome: 'invalid',
          canonicalOutcome: 'not_called',
        }
      );
    }
    if (parsed.data.year !== expected.year) {
      throw new HolidayUnavailableError(
        `Holiday cache wrong year: ${expected.cacheKey}`,
        {
          code: 'holiday_data_invalid',
          requestedYear: expected.year,
          cacheOutcome: 'invalid',
          canonicalOutcome: 'not_called',
        }
      );
    }
    if (parsed.data.scope !== expected.scope) {
      throw new HolidayUnavailableError(
        `Holiday cache wrong scope: ${expected.cacheKey}`,
        {
          code: 'holiday_data_invalid',
          requestedYear: expected.year,
          cacheOutcome: 'invalid',
          canonicalOutcome: 'not_called',
        }
      );
    }
    return { holidays: parsed.data.holidays as Holiday[], legacy: false };
  }

  throw new HolidayUnavailableError(`Holiday cache corrupt: ${expected.cacheKey}`, {
    code: 'holiday_data_invalid',
    requestedYear: expected.year,
    cacheOutcome: 'invalid',
    canonicalOutcome: 'not_called',
  });
}

/** Validate Redis payload is a trusted holiday list (empty array = no holidays). */
export function parseTrustedHolidayList(raw: unknown, cacheKey: string): Holiday[] {
  if (raw === null || raw === undefined) {
    throw new HolidayUnavailableError(`Holiday cache miss: ${cacheKey}`, {
      cacheOutcome: 'miss',
    });
  }
  if (!Array.isArray(raw)) {
    throw new HolidayUnavailableError(`Holiday cache corrupt: ${cacheKey}`, {
      code: 'holiday_data_invalid',
      cacheOutcome: 'invalid',
    });
  }
  for (const item of raw) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as Holiday).date !== 'string'
    ) {
      throw new HolidayUnavailableError(`Holiday cache corrupt: ${cacheKey}`, {
        code: 'holiday_data_invalid',
        cacheOutcome: 'invalid',
      });
    }
  }
  return raw as Holiday[];
}

function normalizeCanonicalHolidays(
  holidays: Holiday[],
  year: number
): Holiday[] {
  const normalized: Holiday[] = [];
  for (const h of holidays) {
    const item = HolidayItemSchema.safeParse({
      id: String(h.id),
      name: h.name,
      date: h.date,
      shift_name: h.shift_name,
      location_name: h.location_name,
      remarks: h.remarks,
      is_holiday: h.is_holiday,
    });
    if (!item.success) {
      throw new HolidayUnavailableError('Canonical holiday data is invalid', {
        code: 'holiday_data_invalid',
        requestedYear: year,
        canonicalOutcome: 'invalid',
      });
    }
    if (!isStrictCalendarIsoDate(item.data.date)) {
      throw new HolidayUnavailableError('Canonical holiday date is invalid', {
        code: 'holiday_data_invalid',
        requestedYear: year,
        canonicalOutcome: 'invalid',
      });
    }
    if (!item.data.date.startsWith(`${year}-`)) {
      throw new HolidayUnavailableError(
        `Canonical holiday date ${item.data.date} is outside year ${year}`,
        {
          code: 'holiday_data_invalid',
          requestedYear: year,
          canonicalOutcome: 'invalid',
        }
      );
    }
    if (!item.data.id.trim() || !item.data.name.trim()) {
      throw new HolidayUnavailableError('Canonical holiday id/name is empty', {
        code: 'holiday_data_invalid',
        requestedYear: year,
        canonicalOutcome: 'invalid',
      });
    }
    normalized.push(item.data);
  }
  return normalized;
}

async function writeHolidayCache(
  redis: HolidayRedis,
  scope: string,
  year: number,
  holidays: Holiday[],
  requestId?: string
): Promise<'refreshed' | 'write_failed'> {
  const cacheKey = holidayCacheKey(scope, year);
  const envelope = buildHolidayCacheEnvelope({ scope, year, holidays });
  try {
    await redis.setex(
      cacheKey,
      HOLIDAY_CACHE_TTL_SECONDS,
      JSON.stringify(envelope)
    );
    return 'refreshed';
  } catch (error) {
    logHoliday({
      message: 'holiday_cache_write_failed_but_source_available',
      requestId,
      requestedYear: year,
      cacheKeyScope: scope,
      cacheOutcome: 'write_failed',
      canonicalOutcome: holidays.length === 0 ? 'empty_success' : 'success',
      error: error instanceof Error ? error.message : 'unknown',
    });
    return 'write_failed';
  }
}

async function loadCanonicalForScope(
  locationForZoho: string | undefined,
  year: number,
  deps: GetHolidaysDeps
): Promise<Holiday[]> {
  const load =
    deps.loadCanonical ??
    ((input: { location?: string; year: number }) => getYearlyHolidays(input));
  try {
    const raw = deps.loadCanonical
      ? await load({ location: locationForZoho, year })
      : await retryWithBackoff(() => load({ location: locationForZoho, year }));
    return normalizeCanonicalHolidays(raw, year);
  } catch (error) {
    if (error instanceof HolidayUnavailableError) {
      throw error;
    }
    if (error instanceof ZohoHolidayParseError) {
      throw new HolidayUnavailableError(error.message, {
        code: 'holiday_data_invalid',
        requestedYear: year,
        canonicalOutcome: 'invalid',
      });
    }
    throw new HolidayUnavailableError(
      error instanceof Error ? error.message : 'Holiday source unavailable',
      {
        code: 'holiday_source_unavailable',
        requestedYear: year,
        canonicalOutcome: 'failed',
      }
    );
  }
}

/**
 * Cache-aside load for one scope key (location name or "default").
 */
export async function loadHolidaysForScope(
  scope: string,
  locationForZoho: string | undefined,
  year: number,
  deps: GetHolidaysDeps = {}
): Promise<Holiday[]> {
  const redis = deps.redis ?? getRedisClient();
  const cacheKey = holidayCacheKey(scope, year);
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let cacheOutcome: HolidayCacheOutcome = 'miss';
  let canonicalOutcome: HolidayCanonicalOutcome = 'not_called';
  const started = Date.now();

  // 1) Try cache
  try {
    const raw = await redis.get<unknown>(cacheKey);
    if (raw !== null && raw !== undefined) {
      try {
        const parsed = parseHolidayCachePayload(raw, {
          scope,
          year,
          cacheKey,
        });
        if (parsed.legacy) {
          // Opportunistically upgrade to envelope (best-effort)
          void writeHolidayCache(
            redis,
            scope,
            year,
            parsed.holidays,
            deps.requestId
          );
        }
        logHoliday({
          message: 'holiday_cache_hit',
          requestId: deps.requestId,
          requestedYear: year,
          cacheKeyScope: scope,
          cacheOutcome: 'hit',
          canonicalOutcome: 'not_called',
          durationMs: Date.now() - started,
        });
        return parsed.holidays;
      } catch (error) {
        if (
          error instanceof HolidayUnavailableError &&
          error.cacheOutcome === 'miss'
        ) {
          cacheOutcome = 'miss';
        } else {
          cacheOutcome = 'invalid';
          try {
            await redis.del(cacheKey);
          } catch {
            /* ignore */
          }
        }
      }
    } else {
      cacheOutcome = 'miss';
    }
  } catch (error) {
    if (error instanceof HolidayUnavailableError) {
      throw error;
    }
    cacheOutcome = 'read_failed';
    logHoliday({
      message: 'holiday_cache_read_failed',
      requestId: deps.requestId,
      requestedYear: year,
      cacheKeyScope: scope,
      cacheOutcome: 'read_failed',
      error: error instanceof Error ? error.message : 'unknown',
    });
  }

  // 2) Coalesce concurrent refreshes
  const lockKey = holidayRefreshLockKey(scope, year);
  let acquired = false;
  try {
    acquired = await redis.setNx(lockKey, '1', HOLIDAY_REFRESH_LOCK_TTL_SECONDS);
  } catch {
    acquired = true; // Redis lock unavailable — proceed with canonical load
  }

  if (!acquired && !deps.skipRefreshWait) {
    for (let i = 0; i < REFRESH_WAIT_ATTEMPTS; i++) {
      await sleep(REFRESH_WAIT_MS);
      try {
        const raw = await redis.get<unknown>(cacheKey);
        if (raw !== null && raw !== undefined) {
          const parsed = parseHolidayCachePayload(raw, {
            scope,
            year,
            cacheKey,
          });
          logHoliday({
            message: 'holiday_cache_hit_after_wait',
            requestId: deps.requestId,
            requestedYear: year,
            cacheKeyScope: scope,
            cacheOutcome: 'hit',
            canonicalOutcome: 'not_called',
            durationMs: Date.now() - started,
          });
          return parsed.holidays;
        }
      } catch {
        /* keep waiting / fall through */
      }
    }
  }

  // 3) Canonical load (required on miss/invalid/read_failed)
  let holidays: Holiday[];
  try {
    holidays = await loadCanonicalForScope(locationForZoho, year, deps);
    canonicalOutcome = holidays.length === 0 ? 'empty_success' : 'success';
  } catch (error) {
    canonicalOutcome =
      error instanceof HolidayUnavailableError &&
      error.code === 'holiday_data_invalid'
        ? 'invalid'
        : 'failed';
    logHoliday({
      message: 'holiday_canonical_failed',
      requestId: deps.requestId,
      requestedYear: year,
      cacheKeyScope: scope,
      cacheOutcome,
      canonicalOutcome,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'unknown',
    });
    if (error instanceof HolidayUnavailableError) {
      throw new HolidayUnavailableError(error.message, {
        code: error.code,
        requestedYear: year,
        cacheOutcome,
        canonicalOutcome,
      });
    }
    throw new HolidayUnavailableError('Holiday source unavailable', {
      code: 'holiday_source_unavailable',
      requestedYear: year,
      cacheOutcome,
      canonicalOutcome: 'failed',
    });
  }

  // 4) Populate cache (failure must not block the request)
  const writeOutcome = await writeHolidayCache(
    redis,
    scope,
    year,
    holidays,
    deps.requestId
  );
  if (
    scope !== 'default' &&
    envDefaultLocation() &&
    scope === envDefaultLocation()
  ) {
    await writeHolidayCache(redis, 'default', year, holidays, deps.requestId);
  }

  if (acquired) {
    try {
      await redis.del(lockKey);
    } catch {
      /* lock TTL covers leak */
    }
  }

  logHoliday({
    message:
      writeOutcome === 'write_failed'
        ? 'holiday_cache_write_failed_but_source_available'
        : cacheOutcome === 'miss'
          ? 'holiday_cache_miss_recovered'
          : cacheOutcome === 'invalid'
            ? 'holiday_cache_invalid_recovered'
            : 'holiday_cache_refreshed',
    requestId: deps.requestId,
    requestedYear: year,
    cacheKeyScope: scope,
    cacheOutcome: writeOutcome === 'write_failed' ? 'write_failed' : 'refreshed',
    canonicalOutcome,
    durationMs: Date.now() - started,
  });

  return holidays;
}

/**
 * Fetch and cache holidays for all locations and years (previous, current, next).
 * Proactive warmup — correctness does not depend on this (cache-aside recovers).
 */
export async function refreshHolidayCache(): Promise<void> {
  try {
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

    try {
      for (const year of years) {
        const oldKey = `holiday:${year}`;
        try {
          const oldData = await redis.get(oldKey);
          if (oldData) {
            await redis.del(oldKey);
          }
        } catch (error) {
          console.warn(
            `[Holiday Cache] Error deleting old key "${oldKey}":`,
            error
          );
        }
      }
    } catch (error) {
      console.warn(
        '[Holiday Cache] Error cleaning up old keys (continuing anyway):',
        error
      );
    }

    for (const location of locations) {
      for (const year of years) {
        const fetchPromise = (async () => {
          await retryWithBackoff(async () => {
            await loadHolidaysForScope(location, location, year, {
              redis,
              skipRefreshWait: true,
            });
          });
        })();
        fetchPromises.push(fetchPromise);
      }
    }

    // Ensure default scope is warm even if env default was already in locations
    if (defaultLoc) {
      for (const year of years) {
        fetchPromises.push(
          retryWithBackoff(async () => {
            await loadHolidaysForScope('default', defaultLoc, year, {
              redis,
              skipRefreshWait: true,
            });
          })
        );
      }
    }

    const results = await Promise.allSettled(fetchPromises);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      const errorMessages = failures
        .map((f) => (f.status === 'rejected' ? String(f.reason) : ''))
        .filter(Boolean);
      console.error(
        `[Holiday Cache] Failed to refresh holidays for ${failures.length} location/year combination(s) after ${MAX_RETRIES} retries:`,
        errorMessages
      );
      throw new Error(
        `Failed to refresh holiday cache for ${failures.length} location/year combination(s): ${errorMessages.join('; ')}`
      );
    }
  } catch (error) {
    console.error('[Holiday Cache] Error refreshing holiday cache:', error);
    throw error;
  }
}

/**
 * Get holidays for a location/year via cache-aside (Redis → Zoho on miss).
 *
 * Three outcomes:
 * - Success with holidays
 * - Success with [] (trusted: canonical/cache confirmed no holidays)
 * - Throws HolidayUnavailableError (canonical failure after miss / invalid)
 *
 * Never returns [] to mean "unavailable".
 */
export async function getCachedHolidays(
  location: string | undefined,
  year: number,
  deps?: GetHolidaysDeps
): Promise<Holiday[]> {
  const trimmed = location?.trim();

  if (trimmed) {
    const locationHolidays = await loadHolidaysForScope(
      trimmed,
      trimmed,
      year,
      deps
    );

    // Optional supplemental default list — miss/canonical failure skips merge;
    // corrupt cached default still fails closed.
    const defaultCacheKey = holidayCacheKey('default', year);
    const redis = deps?.redis ?? getRedisClient();
    try {
      const raw = await redis.get<unknown>(defaultCacheKey);
      if (raw !== null && raw !== undefined) {
        try {
          const parsed = parseHolidayCachePayload(raw, {
            scope: 'default',
            year,
            cacheKey: defaultCacheKey,
          });
          return [...locationHolidays, ...parsed.holidays];
        } catch (error) {
          if (
            error instanceof HolidayUnavailableError &&
            error.cacheOutcome === 'invalid'
          ) {
            // Repair default via cache-aside; if that fails, keep location-only
            try {
              const repaired = await loadHolidaysForScope(
                'default',
                envDefaultLocation() || undefined,
                year,
                deps
              );
              return [...locationHolidays, ...repaired];
            } catch {
              throw error;
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof HolidayUnavailableError) {
        throw error;
      }
      // Redis read failure for supplemental default — do not fail location result
      logHoliday({
        message: 'holiday_default_supplement_skipped',
        requestId: deps?.requestId,
        requestedYear: year,
        cacheOutcome: 'read_failed',
        canonicalOutcome: 'not_called',
      });
    }

    return locationHolidays;
  }

  // No staff location → env-default scope key holiday:default:{year}
  return loadHolidaysForScope(
    'default',
    envDefaultLocation() || undefined,
    year,
    deps
  );
}

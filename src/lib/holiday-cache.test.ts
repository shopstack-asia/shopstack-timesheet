import { describe, expect, it, vi } from 'vitest';
import {
  buildHolidayCacheEnvelope,
  getCachedHolidays,
  holidayCacheKey,
  HolidayUnavailableError,
  loadHolidaysForScope,
  parseHolidayCachePayload,
  parseTrustedHolidayList,
} from '@/lib/holiday-cache';
import {
  assertSubmitBusinessRules,
  SubmitPolicyDependencyError,
} from '@/lib/timesheet/submit-policy';
import {
  holidayDependencySafeMessage,
  mapConfirmWriteError,
} from '@/lib/timesheet/write/confirm';
import { SheetsWriteLockError } from '@/lib/sheets-write-lock';
import type { Holiday } from '@/types';

function memoryHolidayRedis(store: Map<string, unknown>) {
  return {
    async get<T>(key: string): Promise<T | null> {
      if (!store.has(key)) return null;
      return store.get(key) as T;
    },
    async setex(key: string, _seconds: number, value: string) {
      store.set(key, JSON.parse(value));
    },
    async del(key: string) {
      store.delete(key);
    },
    async setNx(key: string, value: string, _ttl: number) {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    },
  };
}

const SAMPLE: Holiday[] = [
  { id: '1', date: '2026-01-01', name: 'NY', is_holiday: true },
];

describe('parseTrustedHolidayList', () => {
  it('accepts empty array as trusted no holidays', () => {
    expect(parseTrustedHolidayList([], 'k')).toEqual([]);
  });

  it('throws on cache miss (null)', () => {
    expect(() => parseTrustedHolidayList(null, 'k')).toThrow(
      HolidayUnavailableError
    );
  });

  it('throws on corruption (non-array)', () => {
    expect(() => parseTrustedHolidayList({ date: 'x' }, 'k')).toThrow(
      HolidayUnavailableError
    );
  });

  it('throws on corruption (bad items)', () => {
    expect(() => parseTrustedHolidayList([{ id: 1 }], 'k')).toThrow(
      HolidayUnavailableError
    );
  });
});

describe('parseHolidayCachePayload envelope', () => {
  it('accepts versioned envelope', () => {
    const env = buildHolidayCacheEnvelope({
      scope: 'default',
      year: 2026,
      holidays: SAMPLE,
    });
    const parsed = parseHolidayCachePayload(env, {
      scope: 'default',
      year: 2026,
      cacheKey: 'holiday:default:2026',
    });
    expect(parsed.legacy).toBe(false);
    expect(parsed.holidays).toHaveLength(1);
  });

  it('accepts legacy raw array', () => {
    const parsed = parseHolidayCachePayload(SAMPLE, {
      scope: 'Bangkok',
      year: 2026,
      cacheKey: 'holiday:Bangkok:2026',
    });
    expect(parsed.legacy).toBe(true);
  });

  it('rejects wrong year envelope', () => {
    const env = buildHolidayCacheEnvelope({
      scope: 'default',
      year: 2025,
      holidays: SAMPLE,
    });
    expect(() =>
      parseHolidayCachePayload(env, {
        scope: 'default',
        year: 2026,
        cacheKey: 'holiday:default:2026',
      })
    ).toThrow(HolidayUnavailableError);
  });

  it('rejects wrong scope envelope', () => {
    const env = buildHolidayCacheEnvelope({
      scope: 'Bangkok',
      year: 2026,
      holidays: SAMPLE,
    });
    expect(() =>
      parseHolidayCachePayload(env, {
        scope: 'default',
        year: 2026,
        cacheKey: 'holiday:default:2026',
      })
    ).toThrow(HolidayUnavailableError);
  });

  it('null is miss not empty list', () => {
    expect(() =>
      parseHolidayCachePayload(null, {
        scope: 'default',
        year: 2026,
        cacheKey: 'holiday:default:2026',
      })
    ).toThrow(/cache miss/);
  });
});

describe('getCachedHolidays cache-aside', () => {
  it('valid cache hit returns cached Holidays without canonical load', async () => {
    const store = new Map<string, unknown>([
      [
        holidayCacheKey('Bangkok', 2026),
        buildHolidayCacheEnvelope({
          scope: 'Bangkok',
          year: 2026,
          holidays: SAMPLE,
        }),
      ],
    ]);
    const loadCanonical = vi.fn(async () => SAMPLE);
    const holidays = await getCachedHolidays('Bangkok', 2026, {
      redis: memoryHolidayRedis(store),
      loadCanonical,
      skipRefreshWait: true,
    });
    expect(holidays).toHaveLength(1);
    expect(loadCanonical).not.toHaveBeenCalled();
  });

  it('cache miss loads canonical source and populates Redis', async () => {
    const store = new Map<string, unknown>();
    const loadCanonical = vi.fn(async () => SAMPLE);
    const holidays = await getCachedHolidays('Bangkok', 2026, {
      redis: memoryHolidayRedis(store),
      loadCanonical,
      skipRefreshWait: true,
    });
    expect(holidays).toEqual(SAMPLE);
    expect(loadCanonical).toHaveBeenCalledTimes(1);
    expect(store.has(holidayCacheKey('Bangkok', 2026))).toBe(true);

    const load2 = vi.fn(async () => {
      throw new Error('should not call');
    });
    const second = await getCachedHolidays('Bangkok', 2026, {
      redis: memoryHolidayRedis(store),
      loadCanonical: load2,
      skipRefreshWait: true,
    });
    expect(second).toHaveLength(1);
    expect(load2).not.toHaveBeenCalled();
  });

  it('confirmed empty canonical result is cached and accepted', async () => {
    const store = new Map<string, unknown>();
    const holidays = await getCachedHolidays(undefined, 2026, {
      redis: memoryHolidayRedis(store),
      loadCanonical: async () => [],
      skipRefreshWait: true,
    });
    expect(holidays).toEqual([]);
    expect(store.has(holidayCacheKey('default', 2026))).toBe(true);
  });

  it('missing cache is never interpreted as empty Holiday list without canonical', async () => {
    const store = new Map<string, unknown>();
    await expect(
      getCachedHolidays('Bangkok', 2026, {
        redis: memoryHolidayRedis(store),
        loadCanonical: async () => {
          throw new Error('zoho down');
        },
        skipRefreshWait: true,
      })
    ).rejects.toMatchObject({
      name: 'HolidayUnavailableError',
      cacheOutcome: 'miss',
      canonicalOutcome: 'failed',
    });
    expect(store.has(holidayCacheKey('Bangkok', 2026))).toBe(false);
  });

  it('malformed cache triggers canonical reload', async () => {
    const store = new Map<string, unknown>([
      [holidayCacheKey('Bangkok', 2026), 'not-valid'],
    ]);
    const loadCanonical = vi.fn(async () => SAMPLE);
    const holidays = await getCachedHolidays('Bangkok', 2026, {
      redis: memoryHolidayRedis(store),
      loadCanonical,
      skipRefreshWait: true,
    });
    expect(holidays).toEqual(SAMPLE);
    expect(loadCanonical).toHaveBeenCalled();
  });

  it('wrong-year cache triggers canonical reload', async () => {
    const store = new Map<string, unknown>([
      [
        holidayCacheKey('default', 2026),
        buildHolidayCacheEnvelope({
          scope: 'default',
          year: 2025,
          holidays: SAMPLE,
        }),
      ],
    ]);
    const loadCanonical = vi.fn(async () => SAMPLE);
    await getCachedHolidays(undefined, 2026, {
      redis: memoryHolidayRedis(store),
      loadCanonical,
      skipRefreshWait: true,
    });
    expect(loadCanonical).toHaveBeenCalled();
  });

  it('Redis read failure + canonical success continues', async () => {
    const redis = {
      async get(): Promise<null> {
        throw new Error('redis connection refused');
      },
      async setex() {},
      async del() {},
      async setNx() {
        return true;
      },
    };
    const holidays = await getCachedHolidays('Bangkok', 2026, {
      redis,
      loadCanonical: async () => SAMPLE,
      skipRefreshWait: true,
    });
    expect(holidays).toEqual(SAMPLE);
  });

  it('Redis write failure + canonical success continues', async () => {
    const store = new Map<string, unknown>();
    const redis = {
      async get<T>(key: string): Promise<T | null> {
        if (!store.has(key)) return null;
        return store.get(key) as T;
      },
      async setex() {
        throw new Error('write failed');
      },
      async del() {},
      async setNx() {
        return true;
      },
    };
    const holidays = await getCachedHolidays('Bangkok', 2026, {
      redis,
      loadCanonical: async () => SAMPLE,
      skipRefreshWait: true,
    });
    expect(holidays).toEqual(SAMPLE);
  });

  it('Redis failure + canonical failure blocks', async () => {
    const redis = {
      async get(): Promise<null> {
        throw new Error('redis down');
      },
      async setex() {},
      async del() {},
      async setNx() {
        return true;
      },
    };
    await expect(
      getCachedHolidays('Bangkok', 2026, {
        redis,
        loadCanonical: async () => {
          throw new Error('zoho down');
        },
        skipRefreshWait: true,
      })
    ).rejects.toBeInstanceOf(HolidayUnavailableError);
  });

  it('canonical failure blocks the write path', async () => {
    await expect(
      getCachedHolidays(undefined, 2026, {
        redis: memoryHolidayRedis(new Map()),
        loadCanonical: async () => {
          throw new Error('zoho unavailable');
        },
        skipRefreshWait: true,
      })
    ).rejects.toMatchObject({ code: 'holiday_source_unavailable' });
  });

  it('malformed canonical data blocks', async () => {
    await expect(
      loadHolidaysForScope('default', undefined, 2026, {
        redis: memoryHolidayRedis(new Map()),
        loadCanonical: async () =>
          [{ id: 'x', name: 'bad', date: 'not-a-date', is_holiday: true }] as Holiday[],
        skipRefreshWait: true,
      })
    ).rejects.toMatchObject({ code: 'holiday_data_invalid' });
  });

  it('wrong-year row from canonical loader blocks without caching', async () => {
    const store = new Map<string, unknown>();
    await expect(
      getCachedHolidays('Bangkok', 2026, {
        redis: memoryHolidayRedis(store),
        loadCanonical: async () => [
          {
            id: '1',
            name: 'NY',
            date: '2025-01-01',
            is_holiday: true,
          },
        ],
        skipRefreshWait: true,
      })
    ).rejects.toMatchObject({ code: 'holiday_data_invalid' });
    expect(store.has(holidayCacheKey('Bangkok', 2026))).toBe(false);
  });

  it('legacy raw array cache hit still works', async () => {
    const store = new Map<string, unknown>([
      [holidayCacheKey('Bangkok', 2026), SAMPLE],
    ]);
    const loadCanonical = vi.fn(async () => SAMPLE);
    const holidays = await getCachedHolidays('Bangkok', 2026, {
      redis: memoryHolidayRedis(store),
      loadCanonical,
      skipRefreshWait: true,
    });
    expect(holidays).toEqual(SAMPLE);
    expect(loadCanonical).not.toHaveBeenCalled();
  });

  it('concurrent misses settle on consistent cache', async () => {
    const store = new Map<string, unknown>();
    const redis = memoryHolidayRedis(store);
    let calls = 0;
    const loadCanonical = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return SAMPLE;
    };
    const [a, b] = await Promise.all([
      getCachedHolidays('Bangkok', 2026, {
        redis,
        loadCanonical,
        skipRefreshWait: true,
      }),
      getCachedHolidays('Bangkok', 2026, {
        redis,
        loadCanonical,
        skipRefreshWait: true,
      }),
    ]);
    expect(a).toEqual(SAMPLE);
    expect(b).toEqual(SAMPLE);
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(store.has(holidayCacheKey('Bangkok', 2026))).toBe(true);
  });
});

describe('submit-policy holiday unavailable → 503 dependency', () => {
  const ctx = {
    staff: {
      EmployeeID: 'S1',
      FirstName: 'A',
      LastName: 'B',
      Nickname: 'A',
      Email: 'a@shopstack.asia',
      Position: 'Eng',
    },
    source: 'session' as const,
  };

  it('HolidayUnavailableError from loader → SubmitPolicyDependencyError', async () => {
    await expect(
      assertSubmitBusinessRules(
        ctx,
        '2026-07-14',
        [{ projectId: '1', taskId: '1', hours: 2 }],
        {},
        {
          loadLeave: async () => [],
          loadHolidays: async () => {
            throw new HolidayUnavailableError();
          },
        }
      )
    ).rejects.toMatchObject({
      name: 'SubmitPolicyDependencyError',
      code: 'holiday_source_unavailable',
      requestedYear: 2026,
    });
  });

  it('does not evaluate guards when holidays unavailable', async () => {
    const loadLeave = vi.fn(async () => []);
    await expect(
      assertSubmitBusinessRules(
        ctx,
        '2026-07-14',
        [{ projectId: '1', taskId: '1', hours: 2 }],
        {},
        {
          loadLeave,
          loadHolidays: async () => {
            throw new HolidayUnavailableError('cache miss');
          },
        }
      )
    ).rejects.toBeInstanceOf(SubmitPolicyDependencyError);
    expect(loadLeave).toHaveBeenCalled();
  });

  it('non-holiday date proceeds after successful holiday load', async () => {
    await expect(
      assertSubmitBusinessRules(
        ctx,
        '2026-07-14',
        [{ projectId: '1', taskId: '1', hours: 2 }],
        {},
        {
          loadLeave: async () => [],
          loadHolidays: async () => [],
        }
      )
    ).resolves.toBeUndefined();
  });

  it('holiday date without acknowledgement is blocked', async () => {
    await expect(
      assertSubmitBusinessRules(
        ctx,
        '2026-07-14',
        [{ projectId: '1', taskId: '1', hours: 2 }],
        {},
        {
          loadLeave: async () => [],
          loadHolidays: async () => [
            {
              id: 'h1',
              date: '2026-07-14',
              name: 'Test Day',
              is_holiday: true,
            },
          ],
        }
      )
    ).rejects.toMatchObject({ name: 'SubmitPolicyError' });
  });

  it('holiday date with acknowledgement proceeds', async () => {
    await expect(
      assertSubmitBusinessRules(
        ctx,
        '2026-07-14',
        [{ projectId: '1', taskId: '1', hours: 2 }],
        { holidayAcknowledged: true },
        {
          loadLeave: async () => [],
          loadHolidays: async () => [
            {
              id: 'h1',
              date: '2026-07-14',
              name: 'Test Day',
              is_holiday: true,
            },
          ],
        }
      )
    ).resolves.toBeUndefined();
  });
});

describe('confirm typed holiday dependency messages', () => {
  it('maps holiday dependency to year-specific Slack message', () => {
    const msg = mapConfirmWriteError(
      new SubmitPolicyDependencyError('x', {
        code: 'holiday_source_unavailable',
        requestedYear: 2026,
      })
    );
    expect(msg).toBe(holidayDependencySafeMessage(2026));
    expect(msg).not.toMatch(/identity|employee|Redis|OpenAI/i);
  });

  it('maps SheetsWriteLockError without losing type', () => {
    const msg = mapConfirmWriteError(
      new SheetsWriteLockError('LOCK_TIMEOUT', 'busy')
    );
    expect(msg).toMatch(/คำขออื่น/);
  });
});

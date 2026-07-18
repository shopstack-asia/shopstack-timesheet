import { describe, expect, it, vi } from 'vitest';
import {
  getCachedHolidays,
  HolidayUnavailableError,
  parseTrustedHolidayList,
} from '@/lib/holiday-cache';
import {
  assertSubmitBusinessRules,
  SubmitPolicyDependencyError,
} from '@/lib/timesheet/submit-policy';

function memoryHolidayRedis(store: Map<string, unknown>) {
  return {
    async get<T>(key: string): Promise<T | null> {
      if (!store.has(key)) return null;
      return store.get(key) as T;
    },
    async setex() {
      /* unused in read tests */
    },
    async del() {
      /* unused */
    },
  };
}

const throwingRedis = {
  async get(): Promise<null> {
    throw new Error('redis connection refused');
  },
  async setex() {},
  async del() {},
};

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

describe('getCachedHolidays fail-closed', () => {
  it('returns holidays on cache hit', async () => {
    const store = new Map<string, unknown>([
      [
        'holiday:Bangkok:2026',
        [{ id: '1', date: '2026-01-01', name: 'NY', is_holiday: true }],
      ],
    ]);
    const holidays = await getCachedHolidays('Bangkok', 2026, {
      redis: memoryHolidayRedis(store),
    });
    expect(holidays).toHaveLength(1);
    expect(holidays[0]?.date).toBe('2026-01-01');
  });

  it('returns empty array only when cache present with []', async () => {
    const store = new Map<string, unknown>([['holiday:Bangkok:2026', []]]);
    const holidays = await getCachedHolidays('Bangkok', 2026, {
      redis: memoryHolidayRedis(store),
    });
    expect(holidays).toEqual([]);
  });

  it('throws on cache miss', async () => {
    const store = new Map<string, unknown>();
    await expect(
      getCachedHolidays('Bangkok', 2026, { redis: memoryHolidayRedis(store) })
    ).rejects.toBeInstanceOf(HolidayUnavailableError);
  });

  it('throws when Redis get throws', async () => {
    await expect(
      getCachedHolidays('Bangkok', 2026, { redis: throwingRedis })
    ).rejects.toBeInstanceOf(HolidayUnavailableError);
  });

  it('throws on cache corruption', async () => {
    const store = new Map<string, unknown>([
      ['holiday:Bangkok:2026', 'not-an-array'],
    ]);
    await expect(
      getCachedHolidays('Bangkok', 2026, { redis: memoryHolidayRedis(store) })
    ).rejects.toBeInstanceOf(HolidayUnavailableError);
  });

  it('throws on missing default key when no location', async () => {
    const store = new Map<string, unknown>();
    await expect(
      getCachedHolidays(undefined, 2026, { redis: memoryHolidayRedis(store) })
    ).rejects.toBeInstanceOf(HolidayUnavailableError);
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
    ).rejects.toBeInstanceOf(SubmitPolicyDependencyError);
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
});

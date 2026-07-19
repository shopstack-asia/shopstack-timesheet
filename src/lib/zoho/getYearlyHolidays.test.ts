import { describe, expect, it, vi } from 'vitest';
import {
  extractHolidayArray,
  getYearlyHolidays,
  normalizeHolidayRecord,
  parseZohoHolidayPayload,
  ZohoHolidayParseError,
} from '@/lib/zoho/getYearlyHolidays';
import {
  getCachedHolidays,
  holidayCacheKey,
  HolidayUnavailableError,
} from '@/lib/holiday-cache';
import {
  assertSubmitBusinessRules,
  SubmitPolicyDependencyError,
} from '@/lib/timesheet/submit-policy';
import {
  holidayDependencySafeMessage,
  mapConfirmWriteError,
} from '@/lib/timesheet/write/confirm';

vi.mock('@/lib/zoho-people', () => ({
  getZohoPeopleService: () => ({
    getValidAccessTokenForApi: async () => 'token',
    refreshAccessTokenForApi: async () => 'token',
    getAllEmployees: async () => [],
  }),
}));

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
    async setNx(key: string, value: string) {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('extractHolidayArray strict shapes', () => {
  it('accepts top-level array including empty', () => {
    expect(extractHolidayArray([])).toEqual({ ok: true, records: [] });
    expect(extractHolidayArray([{ date: '2026-01-01' }]).ok).toBe(true);
  });

  it('accepts recognized nested empty collections', () => {
    expect(extractHolidayArray({ holidays: [] })).toEqual({
      ok: true,
      records: [],
    });
    expect(extractHolidayArray({ data: [] })).toEqual({ ok: true, records: [] });
    expect(extractHolidayArray({ data: { holidays: [] } })).toEqual({
      ok: true,
      records: [],
    });
    expect(extractHolidayArray({ holiday_list: [] }).ok).toBe(true);
    expect(extractHolidayArray({ holidayList: [] }).ok).toBe(true);
  });

  it('rejects unknown HTTP 200 object shape', () => {
    expect(extractHolidayArray({ status: 'ok', items: [] })).toEqual({
      ok: false,
      reason: 'unrecognized_response_shape',
    });
  });

  it('rejects recognized field with non-array value', () => {
    expect(extractHolidayArray({ holidays: { foo: 1 } })).toMatchObject({
      ok: false,
      reason: 'holidays_not_array',
    });
    expect(extractHolidayArray({ data: 'oops' })).toMatchObject({
      ok: false,
      reason: 'data_not_array',
    });
  });

  it('rejects malformed Zoho row-format payload', () => {
    expect(
      extractHolidayArray({
        response: { result: { Holidays: { row: { FL: [] } } } },
      })
    ).toMatchObject({ ok: false, reason: 'zoho_row_not_array' });

    expect(
      extractHolidayArray({
        response: { result: { Holidays: { row: [{ notFL: true }] } } },
      })
    ).toMatchObject({ ok: false, reason: 'malformed_zoho_row_fl' });
  });
});

describe('parseZohoHolidayPayload', () => {
  it('recognized empty top-level array → []', () => {
    expect(parseZohoHolidayPayload([], 2026)).toEqual([]);
  });

  it('recognized empty nested collection → []', () => {
    expect(parseZohoHolidayPayload({ holidays: [] }, 2026)).toEqual([]);
    expect(parseZohoHolidayPayload({ data: { holidays: [] } }, 2026)).toEqual(
      []
    );
  });

  it('unknown shape → ZohoHolidayParseError', () => {
    expect(() => parseZohoHolidayPayload({ weird: true }, 2026)).toThrow(
      ZohoHolidayParseError
    );
  });

  it('impossible date 2026-02-30 → failure', () => {
    expect(() =>
      parseZohoHolidayPayload(
        [{ id: '1', name: 'Bad', date: '2026-02-30', is_holiday: true }],
        2026
      )
    ).toThrow(ZohoHolidayParseError);
  });

  it('holiday outside requested year → failure', () => {
    expect(() =>
      parseZohoHolidayPayload(
        [{ id: '1', name: 'NY', date: '2025-01-01', is_holiday: true }],
        2026
      )
    ).toThrow(/outside requested year/);
  });

  it('missing date → failure', () => {
    expect(() =>
      parseZohoHolidayPayload([{ id: '1', name: 'X', is_holiday: true }], 2026)
    ).toThrow(ZohoHolidayParseError);
  });

  it('mixed valid and invalid rows → entire load fails', () => {
    expect(() =>
      parseZohoHolidayPayload(
        [
          { id: '1', name: 'NY', date: '2026-01-01', is_holiday: true },
          { id: '2', name: 'Bad', date: 'not-a-date', is_holiday: true },
        ],
        2026
      )
    ).toThrow(ZohoHolidayParseError);
  });

  it('valid holiday normalizes', () => {
    const h = normalizeHolidayRecord(
      { id: '1', name: 'NY', date: '01-Jan-2026', is_holiday: 'true' },
      2026
    );
    expect(h.date).toBe('2026-01-01');
    expect(h.is_holiday).toBe(true);
  });
});

describe('getYearlyHolidays HTTP boundary', () => {
  it('invalid JSON → ZohoHolidayParseError and no holidays returned', async () => {
    const fetchFn = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
        text: async () => 'not-json',
      }) as unknown as Response
    );

    await expect(
      getYearlyHolidays(
        { year: 2026, location: 'Bangkok' },
        { fetchFn, getAccessToken: async () => 't' }
      )
    ).rejects.toBeInstanceOf(ZohoHolidayParseError);
  });

  it('unknown 200 shape → ZohoHolidayParseError', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ status: 'success', result: [] })
    );
    await expect(
      getYearlyHolidays(
        { year: 2026 },
        { fetchFn, getAccessToken: async () => 't' }
      )
    ).rejects.toBeInstanceOf(ZohoHolidayParseError);
  });

  it('recognized empty collection succeeds', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ holidays: [] }));
    await expect(
      getYearlyHolidays(
        { year: 2026 },
        { fetchFn, getAccessToken: async () => 't' }
      )
    ).resolves.toEqual([]);
  });
});

describe('cache-aside never caches invalid Zoho payloads', () => {
  it('recognized empty → caches []', async () => {
    const store = new Map<string, unknown>();
    const holidays = await getCachedHolidays('Bangkok', 2026, {
      redis: memoryHolidayRedis(store),
      loadCanonical: async () =>
        parseZohoHolidayPayload({ holidays: [] }, 2026),
      skipRefreshWait: true,
    });
    expect(holidays).toEqual([]);
    expect(store.has(holidayCacheKey('Bangkok', 2026))).toBe(true);
  });

  it('unknown shape → holiday_data_invalid and zero cache writes', async () => {
    const store = new Map<string, unknown>();
    await expect(
      getCachedHolidays('Bangkok', 2026, {
        redis: memoryHolidayRedis(store),
        loadCanonical: async () => parseZohoHolidayPayload({ weird: 1 }, 2026),
        skipRefreshWait: true,
      })
    ).rejects.toMatchObject({
      name: 'HolidayUnavailableError',
      code: 'holiday_data_invalid',
      canonicalOutcome: 'invalid',
    });
    expect(store.has(holidayCacheKey('Bangkok', 2026))).toBe(false);
  });

  it('mixed valid/invalid → no cache write', async () => {
    const store = new Map<string, unknown>();
    await expect(
      getCachedHolidays(undefined, 2026, {
        redis: memoryHolidayRedis(store),
        loadCanonical: async () =>
          parseZohoHolidayPayload(
            [
              { id: '1', name: 'NY', date: '2026-01-01', is_holiday: true },
              { id: '2', name: 'Bad', date: '2026-02-30', is_holiday: true },
            ],
            2026
          ),
        skipRefreshWait: true,
      })
    ).rejects.toBeInstanceOf(HolidayUnavailableError);
    expect(store.has(holidayCacheKey('default', 2026))).toBe(false);
  });

  it('production getYearlyHolidays invalid shape maps through cache-aside', async () => {
    const store = new Map<string, unknown>();
    const fetchFn = vi.fn(async () => jsonResponse({ unexpected: true }));
    await expect(
      getCachedHolidays('Bangkok', 2026, {
        redis: memoryHolidayRedis(store),
        loadCanonical: async (input) =>
          getYearlyHolidays(input, {
            fetchFn,
            getAccessToken: async () => 't',
          }),
        skipRefreshWait: true,
      })
    ).rejects.toMatchObject({ code: 'holiday_data_invalid' });
    expect(store.has(holidayCacheKey('Bangkok', 2026))).toBe(false);
  });
});

describe('policy and confirm propagation', () => {
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

  it('Submit Policy maps invalid canonical data', async () => {
    await expect(
      assertSubmitBusinessRules(
        ctx,
        '2026-07-14',
        [{ projectId: '1', taskId: '1', hours: 2 }],
        {},
        {
          loadLeave: async () => [],
          loadHolidays: async () => {
            throw new HolidayUnavailableError('bad', {
              code: 'holiday_data_invalid',
              requestedYear: 2026,
              canonicalOutcome: 'invalid',
            });
          },
        }
      )
    ).rejects.toMatchObject({
      name: 'SubmitPolicyDependencyError',
      code: 'holiday_data_invalid',
      requestedYear: 2026,
    });
  });

  it('confirm message is year-specific and not identity', () => {
    const msg = mapConfirmWriteError(
      new SubmitPolicyDependencyError('x', {
        code: 'holiday_data_invalid',
        requestedYear: 2026,
      })
    );
    expect(msg).toBe(holidayDependencySafeMessage(2026));
    expect(msg).not.toMatch(/identity|employee|Redis/i);
  });

  it('Sheets writer path is after Holiday policy in submitDayTimesheetForStaff', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src/lib/timesheet/timesheet-service.ts'),
      'utf8'
    );
    const policyIdx = src.indexOf('await assertSubmitBusinessRules');
    const lockIdx = src.indexOf('await withTimeLogWriteLock');
    expect(policyIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeGreaterThan(policyIdx);
  });
});

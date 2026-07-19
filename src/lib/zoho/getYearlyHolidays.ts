/**
 * Zoho yearly holidays — strict parse of recognized response shapes only.
 * Unknown / partial / malformed payloads throw ZohoHolidayParseError (never silent []).
 */

import { format, parse, isValid } from 'date-fns';
import { getZohoPeopleService } from '@/lib/zoho-people';
import { Holiday } from '@/types';

const HOLIDAYS_ENDPOINT = 'https://people.zoho.com/people/api/leave/v2/holidays/get';
const REQUEST_DATE_FORMAT = 'dd-MMM-yyyy';
const SUPPORTED_RESPONSE_FORMATS = ['dd-MMM-yyyy', 'yyyy-MM-dd'] as const;

export interface GetYearlyHolidaysInput {
  location?: string;
  year: number;
}

export type GetYearlyHolidaysDeps = {
  fetchFn?: typeof fetch;
  getAccessToken?: () => Promise<string>;
  refreshAccessToken?: () => Promise<string>;
};

/** Malformed / unrecognized Zoho holiday payload — map to holiday_data_invalid upstream. */
export class ZohoHolidayParseError extends Error {
  readonly kind = 'holiday_data_invalid' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ZohoHolidayParseError';
  }
}

type HolidayRecord = Record<string, unknown>;

type ExtractOk = { ok: true; records: HolidayRecord[] };
type ExtractErr = { ok: false; reason: string };
type ExtractResult = ExtractOk | ExtractErr;

const buildDateRange = (year: number) => {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  return {
    from: format(start, REQUEST_DATE_FORMAT),
    to: format(end, REQUEST_DATE_FORMAT),
  };
};

/** True only for real calendar dates (rejects 2026-02-30, etc.). */
export function isStrictCalendarIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

const normalizeDate = (value?: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const str = String(value).trim();
  if (!str) {
    return null;
  }

  for (const pattern of SUPPORTED_RESPONSE_FORMATS) {
    const parsed = parse(str, pattern, new Date());
    if (isValid(parsed)) {
      const iso = format(parsed, 'yyyy-MM-dd');
      if (isStrictCalendarIsoDate(iso)) {
        // Reject date-fns overflow (e.g. Feb 30 → Mar 2)
        if (pattern === 'yyyy-MM-dd' && iso !== str) {
          return null;
        }
        if (pattern === 'dd-MMM-yyyy') {
          const roundTrip = format(parsed, 'dd-MMM-yyyy');
          // Allow case differences in month abbrev by comparing via ISO only
          if (!isStrictCalendarIsoDate(iso)) {
            return null;
          }
          void roundTrip;
        }
        return iso;
      }
      return null;
    }
  }

  return null;
};

const parseIsHoliday = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const str = String(value).trim().toLowerCase();
  if (str === 'true' || str === '1' || str === 'yes') return true;
  if (str === 'false' || str === '0' || str === 'no') return false;
  throw new ZohoHolidayParseError(`Invalid is_holiday value: ${String(value)}`);
};

/**
 * Normalize one holiday row. Throws ZohoHolidayParseError on any malformed field.
 * Does not silently drop rows.
 */
export function normalizeHolidayRecord(
  record: unknown,
  year: number
): Holiday {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new ZohoHolidayParseError('Holiday row is not an object');
  }
  const r = record as HolidayRecord;

  const date =
    normalizeDate(r.date) ||
    normalizeDate(r.holiday_date) ||
    normalizeDate(r.HolidayDate) ||
    normalizeDate(r['Holiday Date']) ||
    normalizeDate(r['Date']) ||
    normalizeDate(r.Date);

  if (!date) {
    throw new ZohoHolidayParseError('Holiday row missing or invalid date');
  }
  if (!date.startsWith(`${year}-`)) {
    throw new ZohoHolidayParseError(
      `Holiday date ${date} is outside requested year ${year}`
    );
  }

  const nameRaw =
    r.name ||
    r.holiday_name ||
    r.HolidayName ||
    r['Holiday Name'] ||
    r.Name;
  const name = nameRaw !== undefined && nameRaw !== null ? String(nameRaw).trim() : '';
  if (!name) {
    throw new ZohoHolidayParseError('Holiday row missing name');
  }

  const idRaw =
    r.id ||
    r.holiday_id ||
    r.holidayId ||
    r.HolidayID ||
    r.HolidayId ||
    `${date}-${name}`;
  const id = String(idRaw).trim();
  if (!id) {
    throw new ZohoHolidayParseError('Holiday row missing id');
  }

  const is_holiday = parseIsHoliday(r.is_holiday);

  const optionalString = (v: unknown): string | undefined => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s || undefined;
  };

  return {
    id,
    name,
    date,
    shift_name: optionalString(
      r.shift_name || r.shift || r.Shift || r['Shift Name'] || r.ShiftName
    ),
    location_name: optionalString(
      r.location_name ||
        r.location ||
        r.Location ||
        r['Location Name'] ||
        r.LocationName
    ),
    remarks: optionalString(
      r.remarks ||
        r.description ||
        r.Description ||
        r['Holiday Description'] ||
        r.Remarks
    ),
    is_holiday,
  };
}

function unwrapRowFormat(rows: unknown): ExtractResult {
  if (!Array.isArray(rows)) {
    return { ok: false, reason: 'zoho_row_not_array' };
  }
  const records: HolidayRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, reason: 'malformed_zoho_row' };
    }
    const fl = (row as { FL?: unknown }).FL;
    if (!Array.isArray(fl)) {
      return { ok: false, reason: 'malformed_zoho_row_fl' };
    }
    const flattened: Record<string, string> = {};
    for (const field of fl) {
      if (!field || typeof field !== 'object') {
        return { ok: false, reason: 'malformed_zoho_row_field' };
      }
      const f = field as { val?: unknown; content?: unknown };
      if (typeof f.val !== 'string') {
        return { ok: false, reason: 'malformed_zoho_row_field' };
      }
      flattened[f.val] = f.content === undefined || f.content === null
        ? ''
        : String(f.content);
    }
    records.push(flattened);
  }
  return { ok: true, records };
}

/**
 * Extract holiday records from a recognized Zoho response shape only.
 * Unknown shapes and non-array collection fields are errors — never silent [].
 */
export function extractHolidayArray(payload: unknown): ExtractResult {
  if (payload === null || payload === undefined) {
    return { ok: false, reason: 'empty_payload' };
  }

  if (Array.isArray(payload)) {
    return { ok: true, records: payload as HolidayRecord[] };
  }

  if (typeof payload !== 'object') {
    return { ok: false, reason: 'non_object_payload' };
  }

  const obj = payload as Record<string, unknown>;

  const asArrayField = (
    value: unknown,
    fieldName: string
  ): ExtractResult | 'absent' => {
    if (value === undefined) return 'absent';
    if (!Array.isArray(value)) {
      return { ok: false, reason: `${fieldName}_not_array` };
    }
    return { ok: true, records: value as HolidayRecord[] };
  };

  // Top-level recognized collection fields (present + non-array → invalid)
  for (const key of ['holidays', 'holiday_list', 'holidayList'] as const) {
    const field = asArrayField(obj[key], key);
    if (field !== 'absent') {
      return field;
    }
  }

  // `data` may be the collection itself or an object with `.holidays`
  if (obj.data !== undefined) {
    if (Array.isArray(obj.data)) {
      return { ok: true, records: obj.data as HolidayRecord[] };
    }
    if (obj.data && typeof obj.data === 'object') {
      const nested = (obj.data as Record<string, unknown>).holidays;
      if (nested !== undefined) {
        const nestedResult = asArrayField(nested, 'data.holidays');
        if (nestedResult === 'absent') {
          return { ok: false, reason: 'data_holidays_absent' };
        }
        return nestedResult;
      }
      return { ok: false, reason: 'data_not_array' };
    }
    return { ok: false, reason: 'data_not_array' };
  }

  const response = obj.response;
  if (response !== undefined) {
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      return { ok: false, reason: 'invalid_response_shape' };
    }
    const result = (response as Record<string, unknown>).result;
    if (result !== undefined) {
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return { ok: false, reason: 'invalid_result_shape' };
      }
      const holidaysNode = (result as Record<string, unknown>).Holidays;
      if (holidaysNode !== undefined) {
        if (
          !holidaysNode ||
          typeof holidaysNode !== 'object' ||
          Array.isArray(holidaysNode)
        ) {
          return { ok: false, reason: 'invalid_holidays_node' };
        }
        const row = (holidaysNode as Record<string, unknown>).row;
        if (row === undefined) {
          return { ok: false, reason: 'missing_holidays_row' };
        }
        return unwrapRowFormat(row);
      }
    }
  }

  return { ok: false, reason: 'unrecognized_response_shape' };
}

/**
 * Strict parse of one Zoho holiday page payload for the requested year.
 * Recognized empty collections return []. Unknown/partial/invalid throw.
 */
export function parseZohoHolidayPayload(
  payload: unknown,
  year: number
): Holiday[] {
  if (!Number.isFinite(year) || year < 2000) {
    throw new ZohoHolidayParseError('Invalid year for holiday parse');
  }

  const extracted = extractHolidayArray(payload);
  if (!extracted.ok) {
    throw new ZohoHolidayParseError(
      `Unrecognized or invalid Zoho holiday response (${extracted.reason})`
    );
  }

  const holidays: Holiday[] = [];
  for (const record of extracted.records) {
    holidays.push(normalizeHolidayRecord(record, year));
  }
  return holidays;
}

const buildUrl = (
  location: string | undefined,
  from: string,
  to: string,
  page?: number,
  limit?: number
) => {
  const url = new URL(HOLIDAYS_ENDPOINT);
  if (location) {
    url.searchParams.set('location', location);
  }
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('dateFormat', REQUEST_DATE_FORMAT);

  if (page !== undefined) {
    url.searchParams.set('page', page.toString());
  }
  if (limit !== undefined) {
    url.searchParams.set('limit', limit.toString());
  }

  return url.toString();
};

const fetchHolidays = async (
  token: string,
  location: string | undefined,
  from: string,
  to: string,
  page: number | undefined,
  limit: number | undefined,
  fetchFn: typeof fetch
) => {
  return fetchFn(buildUrl(location, from, to, page, limit), {
    method: 'GET',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
    },
    cache: 'no-store',
  });
};

export async function getYearlyHolidays(
  { location, year }: GetYearlyHolidaysInput,
  deps: GetYearlyHolidaysDeps = {}
): Promise<Holiday[]> {
  if (!Number.isFinite(year)) {
    throw new ZohoHolidayParseError('Year is required to fetch holidays');
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const zohoService = getZohoPeopleService();
  const getToken =
    deps.getAccessToken ?? (() => zohoService.getValidAccessTokenForApi());
  const refreshToken =
    deps.refreshAccessToken ?? (() => zohoService.refreshAccessTokenForApi());

  const { from, to } = buildDateRange(year);

  const allHolidays: Holiday[] = [];
  const PAGE_LIMIT = 200;
  const MAX_PAGES = 100;
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= MAX_PAGES) {
    let accessToken = await getToken();
    let response = await fetchHolidays(
      accessToken,
      location,
      from,
      to,
      page,
      PAGE_LIMIT,
      fetchFn
    );

    if (response.status === 401) {
      accessToken = await refreshToken();
      response = await fetchHolidays(
        accessToken,
        location,
        from,
        to,
        page,
        PAGE_LIMIT,
        fetchFn
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Zoho holiday API request failed (${response.status}): ${errorText || response.statusText}`
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ZohoHolidayParseError('Unable to parse Zoho holiday response JSON');
    }

    const pageHolidays = parseZohoHolidayPayload(payload, year);
    allHolidays.push(...pageHolidays);

    const extracted = extractHolidayArray(payload);
    const recordCount = extracted.ok ? extracted.records.length : 0;

    const hasMoreData =
      (payload &&
        typeof payload === 'object' &&
        !Array.isArray(payload) &&
        Boolean(
          (payload as Record<string, unknown>).hasMore ||
            (payload as Record<string, unknown>).moreRecords ||
            (payload as Record<string, unknown>).nextPage ||
            (
              (payload as Record<string, unknown>).pageInfo as
                | { hasMore?: boolean }
                | undefined
            )?.hasMore ||
            (
              (
                (payload as Record<string, unknown>).response as
                  | { pageInfo?: { hasMore?: boolean } }
                  | undefined
              )?.pageInfo
            )?.hasMore
        )) ||
      false;

    if (recordCount < PAGE_LIMIT) {
      hasMore = false;
    } else if (hasMoreData) {
      page++;
    } else if (recordCount === PAGE_LIMIT) {
      page++;
    } else {
      hasMore = false;
    }
  }

  if (page > MAX_PAGES) {
    console.warn(
      `[Zoho] Reached maximum page limit (${MAX_PAGES}). There might be more holidays not fetched.`
    );
  }

  return allHolidays;
}

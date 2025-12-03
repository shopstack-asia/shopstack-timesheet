import { format, parse, isValid } from 'date-fns';
import { getZohoPeopleService } from '@/lib/zoho-people';
import { Holiday } from '@/types';

const HOLIDAYS_ENDPOINT = 'https://people.zoho.com/people/api/leave/v2/holidays/get';
const REQUEST_DATE_FORMAT = 'dd-MMM-yyyy';
const SUPPORTED_RESPONSE_FORMATS = ['dd-MMM-yyyy', 'yyyy-MM-dd'];

export interface GetYearlyHolidaysInput {
  location?: string;
  year: number;
}

type HolidayRecord = Record<string, any>;

const buildDateRange = (year: number) => {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  return {
    from: format(start, REQUEST_DATE_FORMAT),
    to: format(end, REQUEST_DATE_FORMAT),
  };
};

const normalizeDate = (value?: string): string | null => {
  if (!value) {
    return null;
  }

  for (const pattern of SUPPORTED_RESPONSE_FORMATS) {
    const parsed = parse(value, pattern, new Date());
    if (isValid(parsed)) {
      return format(parsed, 'yyyy-MM-dd');
    }
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return format(parsed, 'yyyy-MM-dd');
  }

  return null;
};

const toBoolean = (value: any, fallback = true) => {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const str = String(value).toLowerCase();
  return str === 'true' || str === '1' || str === 'yes';
};

const normalizeRecord = (record: HolidayRecord): Holiday | null => {
  if (!record) {
    return null;
  }

  const date =
    normalizeDate(record.date) ||
    normalizeDate(record.holiday_date) ||
    normalizeDate(record.HolidayDate) ||
    normalizeDate(record['Holiday Date']) ||
    normalizeDate(record['Date']) ||
    normalizeDate(record.Date);

  if (!date) {
    return null;
  }

  const name =
    record.name ||
    record.holiday_name ||
    record.HolidayName ||
    record['Holiday Name'] ||
    record.Name ||
    'Holiday';

  const id =
    record.id ||
    record.holiday_id ||
    record.holidayId ||
    record.HolidayID ||
    record.HolidayId ||
    `${date}-${name}`;

  return {
    id: String(id),
    name,
    date,
    shift_name:
      record.shift_name ||
      record.shift ||
      record.Shift ||
      record['Shift Name'] ||
      record.ShiftName ||
      undefined,
    location_name:
      record.location_name ||
      record.location ||
      record.Location ||
      record['Location Name'] ||
      record.LocationName ||
      undefined,
    remarks:
      record.remarks ||
      record.description ||
      record.Description ||
      record['Holiday Description'] ||
      record.Remarks ||
      undefined,
    is_holiday: toBoolean(record.is_holiday),
  };
};

const unwrapRowFormat = (rows: Array<{ FL: Array<{ val: string; content: string }> }>) => {
  return rows.map((row) => {
    const flattened: Record<string, string> = {};
    (row.FL || []).forEach((field) => {
      flattened[field.val] = field.content;
    });
    return flattened;
  });
};

const extractHolidayArray = (payload: any): HolidayRecord[] => {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  if (Array.isArray(payload.holidays)) {
    return payload.holidays;
  }

  if (Array.isArray(payload.holiday_list)) {
    return payload.holiday_list;
  }

  if (Array.isArray(payload.holidayList)) {
    return payload.holidayList;
  }

  if (Array.isArray(payload.data?.holidays)) {
    return payload.data.holidays;
  }

  if (Array.isArray(payload.response?.result?.Holidays?.row)) {
    return unwrapRowFormat(payload.response.result.Holidays.row);
  }

  return [];
};

const buildUrl = (location: string | undefined, from: string, to: string, page?: number, limit?: number) => {
  const url = new URL(HOLIDAYS_ENDPOINT);
  if (location) {
    url.searchParams.set('location', location);
  }
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('dateFormat', REQUEST_DATE_FORMAT);
  
  // Add pagination parameters if provided
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
  page?: number,
  limit?: number
) => {
  const response = await fetch(buildUrl(location, from, to, page, limit), {
    method: 'GET',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
    },
    cache: 'no-store',
  });

  return response;
};

export async function getYearlyHolidays({
  location,
  year,
}: GetYearlyHolidaysInput): Promise<Holiday[]> {
  if (!Number.isFinite(year)) {
    throw new Error('Year is required to fetch holidays');
  }

  const zohoService = getZohoPeopleService();
  const { from, to } = buildDateRange(year);

  const allHolidays: Holiday[] = [];
  const PAGE_LIMIT = 200; // Zoho API typically limits to 200 records per page
  const MAX_PAGES = 100; // Safety limit to prevent infinite loops
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= MAX_PAGES) {
    let accessToken = await zohoService.getValidAccessTokenForApi();
    let response = await fetchHolidays(accessToken, location, from, to, page, PAGE_LIMIT);

    if (response.status === 401) {
      accessToken = await zohoService.refreshAccessTokenForApi();
      response = await fetchHolidays(accessToken, location, from, to, page, PAGE_LIMIT);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Zoho holiday API request failed (${response.status}): ${errorText || response.statusText}`
      );
    }

    const payload = await response.json().catch((error) => {
      console.error('[Zoho] Failed to parse holiday response', error);
      throw new Error('Unable to parse Zoho holiday response');
    });

    const holidays = extractHolidayArray(payload);
    const normalized = holidays
      .map((record) => normalizeRecord(record))
      .filter((holiday): holiday is Holiday => Boolean(holiday));

    allHolidays.push(...normalized);

    console.log(
      `[Zoho] Fetched page ${page} with ${normalized.length} holidays (total so far: ${allHolidays.length})`
    );

    // Check if there are more pages
    // Zoho API may return pagination info in different formats
    const hasMoreData =
      payload.hasMore ||
      payload.moreRecords ||
      payload.nextPage ||
      (payload.pageInfo && payload.pageInfo.hasMore) ||
      (payload.response && payload.response.pageInfo && payload.response.pageInfo.hasMore) ||
      false;

    // If we got fewer records than the limit, we've reached the last page
    if (holidays.length < PAGE_LIMIT) {
      hasMore = false;
    } else if (hasMoreData) {
      // If API explicitly says there's more, continue
      page++;
    } else {
      // If we got exactly PAGE_LIMIT records, there might be more
      // Try fetching next page to check
      if (holidays.length === PAGE_LIMIT) {
        page++;
        // Continue loop to fetch next page
        // If next page returns empty or fewer records, loop will end
      } else {
        hasMore = false;
      }
    }
  }

  if (page > MAX_PAGES) {
    console.warn(
      `[Zoho] Reached maximum page limit (${MAX_PAGES}). There might be more holidays not fetched.`
    );
  }

  console.log(`[Zoho] Total holidays fetched: ${allHolidays.length} from ${page - 1} page(s)`);
  return allHolidays;
}


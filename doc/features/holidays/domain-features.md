# Holidays — domain features

## Capabilities

1. **Refresh cache** — for each employee location (+ env defaults), years Y-1..Y+1, fetch Zoho yearly holidays with retries; store Redis keys `holiday:{location}:{year}` TTL ~1 year.
2. **Read API** — `GET /api/timesheet/holidays?year=` reads **Redis only** (no live Zoho fallback). Location from session `staffProfile.Location` or env fallbacks.
3. **Cron** — `POST|GET /api/cron/refresh-holidays` with bearer `CRON_SECRET`.
4. **Not in vercel.json** — only friday-reminder is scheduled; refresh-holidays is manual or side-effect of friday-reminder.

## Dependencies

- Zoho holidays + employee locations
- Redis (required for meaningful holiday API results)
- Auth for timesheet holidays GET

## Non-obvious constraints

- Cache miss / Redis failure → API 500 with message to refresh cache.
- Empty location string still calls `getCachedHolidays(undefined, year)` (implementation may return all or fail — see `getCachedHolidays`).
- UI may skip holiday fetch when no location configured client-side.

# Holidays — domain features

## Capabilities

1. **Refresh cache** — for each employee location (+ env defaults), years Y-1..Y+1, fetch Zoho yearly holidays with retries; store Redis keys `holiday:{location}:{year}` (versioned envelope) TTL ~1 year; mirror env-default to `holiday:default:{year}`.
2. **Read / submit path** — `getCachedHolidays` is **cache-aside**: Redis hit → return; miss/invalid/expired → Zoho → populate Redis → return. Never treat miss as empty holidays.
3. **Read API** — `GET /api/timesheet/holidays?year=` uses the same loader. Location from session `staffProfile.Location` or env fallbacks.
4. **Cron** — `POST|GET /api/cron/refresh-holidays` with bearer `CRON_SECRET` (proactive warmup; not required for correctness).
5. **Not in vercel.json** — only friday-reminder is scheduled; refresh-holidays is manual or side-effect of friday-reminder.

## Dependencies

- Zoho holidays + employee locations (canonical source)
- Redis (latency / coalescing; not sole source of truth for writes)
- Auth for timesheet holidays GET

## Non-obvious constraints

- Cache miss → Zoho reload; Zoho failure → 503 / fail-closed write block (never empty-list inference).
- Empty location string uses `holiday:default:{year}` with env-default Zoho location.
- UI may skip holiday fetch when no location configured client-side.
- Year boundary and TTL expiry recover automatically via cache-aside (no manual Redis insert).

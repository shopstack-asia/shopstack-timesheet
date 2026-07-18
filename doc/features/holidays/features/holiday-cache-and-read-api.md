# Holiday cache and read API

### Overview

Holidays are fetched from Zoho into Redis by refresh jobs, then served to authenticated timesheet clients from cache only.

### Business Purpose

Mark non-working days on the weekly grid without calling Zoho on every page load.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff | `GET /api/timesheet/holidays` | Read cached holidays |
| Cron caller with secret | `/api/cron/refresh-holidays` | Rebuild cache |

### Workflow

**Refresh (`refreshHolidayCache`)**

1. Collect unique employee Locations + env default locations.
2. If no locations → warn and return.
3. For years current-1..current+1 and each location: fetch Zoho holidays (retry ×3 exponential backoff), write Redis `holiday:{location}:{year}`.
4. Clean legacy keys `holiday:{year}` when present.

**Read**

1. Resolve location: session Location → `ZOHO_DEFAULT_LOCATION` → `NEXT_PUBLIC_ZOHO_HOLIDAY_LOCATION` → `NEXT_PUBLIC_DEFAULT_LOCATION`.
2. Parse `year` (default current; must be ≥ 2000).
3. `getCachedHolidays(location, year)` from Redis only.
4. Outcomes:
   - **Success** — Redis key present with a holiday array (may be empty = trusted “no holidays”).
   - **Unavailable** — cache miss, Redis error, or corrupt payload → `HolidayUnavailableError` → HTTP **503** (generic message). Never treat miss/error as `[]`.
5. Refresh always writes location keys (including `[]`) so empty is distinguishable from miss. Env-default location is also mirrored to `holiday:default:{year}`.

### Business Logic

- TTL: `365 * 24 * 60 * 60` seconds.
- Friday reminder also calls refresh best-effort before notifying (reminders area).
- Submit policy uses the same loader: unavailable holidays → `SubmitPolicyDependencyError` → HTTP 503 (never evaluate holiday guards on unknown data).

### Validation Rules

- Holidays GET: session required; invalid year → 400; unavailable cache → 503.
- Cron: `Authorization: Bearer ${CRON_SECRET}` via fail-closed `assertCronAuth`.
- Rate limit on holidays GET: `failOpen: false` (Redis down → 503).

### Edge Cases

- Empty `CRON_SECRET` makes required header `Bearer ` (misconfiguration risk).
- No vercel schedule for refresh-holidays alone — rely on friday-reminder or manual trigger.

### API and Integration Behavior

| Route | Auth | Notes |
|-------|------|-------|
| `GET /api/timesheet/holidays?year=` | Session | Redis only |
| `POST/GET /api/cron/refresh-holidays` | Bearer cron | Calls `refreshHolidayCache` |

### Data Model Summary

- `Holiday { id, name, date, shift_name?, location_name?, remarks?, is_holiday }`

### Operation Notes

- Redis is effectively required for holiday reads (cache-only API). Configure:
  - Local: `REDIS_URL=redis://127.0.0.1:6379/7`
  - Upstash: `REDIS_URL=rediss://default:TOKEN@HOST:6379` or `KV_REST_API_URL` + `KV_REST_API_TOKEN`
- Full env catalog: [ops/environment-variables.md](../../ops/features/environment-variables.md).
- After deploy or location changes: `POST /api/cron/refresh-holidays` with `Authorization: Bearer ${CRON_SECRET}` (also triggered best-effort from Friday reminder).
- Location fallbacks: `ZOHO_DEFAULT_LOCATION`, `NEXT_PUBLIC_ZOHO_HOLIDAY_LOCATION`, `NEXT_PUBLIC_DEFAULT_LOCATION`.

### Known Limitations

- Read path never fetches Zoho directly — until refresh succeeds (writes keys, including empty lists), reads fail closed with 503.
- `vercel.json` does not schedule this route alone.

### Source Code References

- `src/lib/holiday-cache.ts`
- `src/lib/zoho/getYearlyHolidays.ts`
- `src/app/api/timesheet/holidays/route.ts`
- `src/app/api/cron/refresh-holidays/route.ts`

### Required tests

- Cache miss / Redis error / corruption → `HolidayUnavailableError`
- Trusted empty array ≠ unavailable
- Invalid year → 400
- Cron 401 without secret
- Read does not call Zoho (mocked)

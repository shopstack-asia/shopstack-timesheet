# Holiday cache and read API

### Overview

Holidays are loaded from **Zoho People** (canonical source) with a **Redis cache-aside** path. Authenticated timesheet clients and submit policy share `getCachedHolidays`.

**`holiday:default:{year}` meaning:** mirror / fallback scope for the env-default location (`ZOHO_DEFAULT_LOCATION` → `NEXT_PUBLIC_ZOHO_HOLIDAY_LOCATION` → `NEXT_PUBLIC_DEFAULT_LOCATION`). Used when staff `Location` is empty, and mirrored when the env-default location is refreshed.

### Business Purpose

Mark non-working days and enforce holiday acknowledgement on Timesheet writes without calling Zoho on every request—while recovering automatically when Redis keys expire or are missing.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff | `GET /api/timesheet/holidays` | Read holidays (cache-aside) |
| Cron caller with secret | `/api/cron/refresh-holidays` | Proactive warmup (optional for correctness) |

### Workflow

**Cache-aside read (`getCachedHolidays` / `loadHolidaysForScope`)**

1. Build scoped key `holiday:{scope}:{year}` (`scope` = staff Location or `default`).
2. Read Redis.
3. **Hit** — validate envelope (or legacy raw array) for matching scope/year → return.
4. **Miss / expired / invalid / wrong year|scope** — load Zoho `getYearlyHolidays`, validate/normalize, write versioned envelope, return.
5. **Redis read failure** — still attempt Zoho; do not treat as empty holidays.
6. **Redis write failure after Zoho success** — return Zoho data for this request; log `holiday_cache_write_failed_but_source_available`.
7. **Zoho failure / malformed / unrecognized payload** — `HolidayUnavailableError` (`holiday_source_unavailable` or `holiday_data_invalid`) → fail closed (zero Timesheet writes; zero holiday cache writes for invalid data).

A trusted empty list (`[]`) is only returned when the **canonical Zoho response is a recognized collection shape** (top-level array, `data`, `holidays`, `holiday_list`, `holidayList`, `data.holidays`, or supported Zoho `response.result.Holidays.row` format) and every row validates—or the collection is explicitly empty. A missing Redis key is **never** interpreted as no holidays.

**Invalid / partial Zoho payloads fail closed:**

- Unknown HTTP 200 object shape → `holiday_data_invalid` (not empty success)
- Recognized field present but not an array → invalid
- Any malformed holiday row (bad/missing date, wrong year, empty id/name, invalid `is_holiday`) → entire load fails
- Mixed valid + invalid rows → entire load fails; **no partial list** is returned or cached
- Invalid JSON → `holiday_data_invalid`
- Zero Redis holiday writes on any of the above
- Submit policy / confirm block before Sheets lock or mutation

**Refresh warmup (`refreshHolidayCache`)** — optional reliability optimization for locations × years Y-1..Y+1. Correctness does not require warmup; cache-aside recovers after deploy / year boundary / TTL expiry.

### Cache envelope

```json
{
  "schemaVersion": 1,
  "scope": "default",
  "year": 2026,
  "loadedAt": "2026-07-19T00:00:00.000Z",
  "source": "zoho",
  "holidays": []
}
```

Legacy raw `Holiday[]` values are still accepted, then upgraded to the envelope on read.

Identity fields, Slack IDs, emails, and secrets are never stored in the holiday cache.

### Business Logic

- TTL: `365 * 24 * 60 * 60` seconds. Expiry → miss → Zoho reload (no permanent holiday loss; no manual yearly Redis insert required).
- Concurrent misses use a short Redis refresh lock (`holiday:refresh-lock:{scope}:{year}`) to reduce stampede; waiters re-read cache, then may load Zoho if still empty.
- Holiday loading runs in submit policy **before** any Google Sheets mutation / write lock.
- Friday reminder still calls refresh best-effort before notifying.
- Submit policy: unavailable holidays → `SubmitPolicyDependencyError` (`holiday_source_unavailable` / `holiday_data_invalid`) → HTTP 503 / Slack year-specific controlled message. Never evaluate holiday guards on unknown data.

### Validation Rules

- Holidays GET: session required; invalid year → 400; Zoho/cache unavailable → 503.
- Cron: `Authorization: Bearer ${CRON_SECRET}` via fail-closed `assertCronAuth`.
- Rate limit on holidays GET: `failOpen: false` (Redis down → 503 for rate limit; holiday path may still try Zoho).

### Edge Cases

- Empty `CRON_SECRET` makes required header `Bearer ` (misconfiguration risk).
- No vercel schedule for refresh-holidays alone — rely on friday-reminder, manual trigger, or cache-aside on first request.
- Year boundary: current and next year reload automatically via cache-aside (and warmup years Y-1..Y+1).

### API and Integration Behavior

| Route | Auth | Notes |
|-------|------|-------|
| `GET /api/timesheet/holidays?year=` | Session | Cache-aside (Redis → Zoho on miss) |
| `POST/GET /api/cron/refresh-holidays` | Bearer cron | Warmup via same loader |

### Data Model Summary

- `Holiday { id, name, date, shift_name?, location_name?, remarks?, is_holiday }`

### Operation Notes

- Redis improves latency but is not the sole source of holiday truth.
- After deploy, missing `holiday:default:2026` recovers on first read/write that needs 2026 holidays (Zoho must be healthy). Manual Redis insert is optional emergency recovery only.
- Location fallbacks: `ZOHO_DEFAULT_LOCATION`, `NEXT_PUBLIC_ZOHO_HOLIDAY_LOCATION`, `NEXT_PUBLIC_DEFAULT_LOCATION`.
- Full env catalog: [ops/environment-variables.md](../../ops/features/environment-variables.md).

### Rollback

Redeploy the previous application version. Do not permanently disable holiday policy. Do not hardcode holiday dates.

### Known Limitations

- Zoho outage still blocks Timesheet writes that require holiday truth (intentional fail-closed).
- `vercel.json` does not schedule refresh-holidays alone.

### Source Code References

- `src/lib/holiday-cache.ts`
- `src/lib/zoho/getYearlyHolidays.ts`
- `src/lib/timesheet/submit-policy.ts`
- `src/lib/timesheet/write/confirm.ts`
- `src/app/api/timesheet/holidays/route.ts`
- `src/app/api/cron/refresh-holidays/route.ts`

### Required tests

- Cache hit / miss / populate / empty trusted / miss ≠ empty
- Malformed / wrong-year / wrong-scope → reload
- Redis read/write failure + Zoho success continues
- Zoho failure blocks; policy holiday ack paths
- Confirm Slack maps holiday dependency (no identity wording)
- **Strict Zoho parse:** recognized empty only; unknown/partial/invalid → `holiday_data_invalid`; zero cache writes; sheets never mutated

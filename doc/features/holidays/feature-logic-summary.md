# Holidays — feature logic summary

| Doc | Description |
|-----|-------------|
| [holiday-cache-and-read-api.md](./features/holiday-cache-and-read-api.md) | Redis cache-aside + Zoho canonical + cron warmup + location resolution |

## Related code

- `src/lib/holiday-cache.ts`
- `src/lib/zoho/getYearlyHolidays.ts`
- `src/app/api/timesheet/holidays/route.ts`
- `src/app/api/cron/refresh-holidays/route.ts`

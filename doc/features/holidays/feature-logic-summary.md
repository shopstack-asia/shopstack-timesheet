# Holidays — feature logic summary

| Doc | Description |
|-----|-------------|
| [holiday-cache-and-read-api.md](./features/holiday-cache-and-read-api.md) | Redis populate/read + cron refresh + location resolution |

## Related code

- `src/lib/holiday-cache.ts`
- `src/lib/zoho/getYearlyHolidays.ts`
- `src/app/api/timesheet/holidays/route.ts`
- `src/app/api/cron/refresh-holidays/route.ts`

# Holidays — feature area

## Purpose

Populate and read Zoho holidays via Redis cache; expose holidays to the timesheet; cron refresh endpoint.

## Scope

- `src/lib/holiday-cache.ts`, `src/lib/zoho/getYearlyHolidays.ts`
- `src/app/api/timesheet/holidays/route.ts`
- `src/app/api/cron/refresh-holidays/route.ts`
- Side-effect refresh from friday-reminder (reminders area)

## Reading order

1. This README
2. [domain-features.md](./domain-features.md)
3. [feature-logic-summary.md](./feature-logic-summary.md)
4. [features/](./features/)
5. Code

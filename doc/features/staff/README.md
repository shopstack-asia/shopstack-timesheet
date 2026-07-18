# Staff — feature area

## Purpose

Session staff profile API and Zoho leave data (range / monthly / yearly), including Redis caching and leave normalization used by the timesheet UI.

## Scope

- `src/app/api/staff/profile/route.ts`
- `src/app/api/staff/leave/route.ts`, `leave/monthly/`, `leave/yearly/`
- `src/lib/leave-utils.ts`
- Zoho leave fetch in `src/lib/zoho-people.ts`

## Reading order

1. This README
2. [domain-features.md](./domain-features.md)
3. [feature-logic-summary.md](./feature-logic-summary.md)
4. [features/](./features/)
5. Code

## UI usage note

Current UI calls **only** `/api/staff/leave/monthly`. Profile / leave / yearly routes exist for API completeness or future use.

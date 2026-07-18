# Timesheet — domain features

## Capabilities

1. **Weekly grid** — Monday–Friday only; column or tab view.
2. **Load week** — `GET /api/timesheet/get?weekStart=` → entries grouped by date for session staff.
3. **Edit entries** — multiple project/task/hours rows per day; searchable selects; hours step 0.25, max 24.
4. **Submit week** — POST each day that still has entries; sync Sheets by `ProjectID|TaskID` key.
5. **Custom projects** — free-text project name under client `*New` flow; server creates Projects row.
6. **Copy yesterday** — copy previous weekday’s entries into an empty non-holiday day.
7. **Leave/holiday UX** — FULL leave or holiday disables add/edit; HALF leave still editable.
8. **Week total + Submit Week** button with client validation.

## Dependencies

- Session `staffProfile` (auth)
- `/api/master/projects`, `/api/master/tasks`
- `/api/staff/leave/monthly`
- `/api/timesheet/holidays`
- Google Sheets Time Log + Projects

## Non-obvious constraints

- UI submit only POSTs days with `entries.length > 0` — **cleared days are not synced**, so API empty-array delete is unused by current UI.
- Client requires `hours > 0` before submit; API Zod allows `hours` 0–24.
- Tasks must be valid Task IDs; `projectId` may be known ID **or** custom name string.
- Holiday fetch skipped in UI when staff has no location (and no env fallback used client-side the same way — see holidays docs).

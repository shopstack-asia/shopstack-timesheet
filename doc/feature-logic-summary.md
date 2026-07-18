# Feature logic summary (global index)

### Overview

Navigation index only. Canonical behavior lives under `doc/features/<feature-area>/`.

### Workflow

1. Identify the business capability.
2. Pick the matching feature area below.
3. Read: README → domain-features → feature-logic-summary → relevant `features/*.md`.
4. Inspect application code last.

## Feature areas and doc paths

| Feature area | Doc folder | README | Area feature-logic summary |
|--------------|------------|--------|----------------------------|
| `auth` | [features/auth/](./features/auth/) | [README.md](./features/auth/README.md) | [feature-logic-summary.md](./features/auth/feature-logic-summary.md) |
| `layout` | [features/layout/](./features/layout/) | [README.md](./features/layout/README.md) | [feature-logic-summary.md](./features/layout/feature-logic-summary.md) |
| `timesheet` | [features/timesheet/](./features/timesheet/) | [README.md](./features/timesheet/README.md) | [feature-logic-summary.md](./features/timesheet/feature-logic-summary.md) |
| `master-data` | [features/master-data/](./features/master-data/) | [README.md](./features/master-data/README.md) | [feature-logic-summary.md](./features/master-data/feature-logic-summary.md) |
| `staff` | [features/staff/](./features/staff/) | [README.md](./features/staff/README.md) | [feature-logic-summary.md](./features/staff/feature-logic-summary.md) |
| `holidays` | [features/holidays/](./features/holidays/) | [README.md](./features/holidays/README.md) | [feature-logic-summary.md](./features/holidays/feature-logic-summary.md) |
| `reminders` | [features/reminders/](./features/reminders/) | [README.md](./features/reminders/README.md) | [feature-logic-summary.md](./features/reminders/feature-logic-summary.md) |
| `ops` | [features/ops/](./features/ops/) | [README.md](./features/ops/README.md) | [feature-logic-summary.md](./features/ops/feature-logic-summary.md) |

## Cross-feature concerns

| Concern | Primary areas | Notes |
|---------|---------------|-------|
| Google Sheets Time Log R/W | `timesheet`, `master-data` | `src/lib/google-sheets.ts` — in-process master cache 5 min |
| Zoho People | `auth`, `staff`, `holidays`, `reminders` | `src/lib/zoho-people.ts`, `src/lib/zoho/` |
| Redis | `staff`, `holidays`, `timesheet` | Leave TTL 21600s; holidays TTL ~1 year; Time Log write lock on submit |
| NextAuth + middleware | `auth`, `layout` | Matcher: `/timesheet`, `/api/timesheet`, `/api/master`, `/api/staff` |
| Cron bearer secret | `reminders`, `holidays` | `Authorization: Bearer ${CRON_SECRET}` |
| Theme / view prefs | `layout` | `localStorage` keys `theme`, `timesheetViewMode` |

### Source Code References

- `src/app/` — pages + API routes
- `src/components/` — timesheet UI
- `src/lib/` — server integrations
- `src/types/index.ts` — shared types
- `vercel.json` — Friday cron schedule `0 0 * * 5` (UTC)

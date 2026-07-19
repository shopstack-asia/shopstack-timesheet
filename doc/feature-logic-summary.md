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
| `slack` | [features/slack/](./features/slack/) | [README.md](./features/slack/README.md) | [feature-logic-summary.md](./features/slack/feature-logic-summary.md) |
| `ai` | [features/ai/](./features/ai/) | [README.md](./features/ai/README.md) | [feature-logic-summary.md](./features/ai/feature-logic-summary.md) |
| `tools` | [features/tools/](./features/tools/) | [README.md](./features/tools/README.md) | [feature-logic-summary.md](./features/tools/feature-logic-summary.md) |
| `business` | [features/business/](./features/business/) | [README.md](./features/business/README.md) | [feature-logic-summary.md](./features/business/feature-logic-summary.md) |
| `business-tools` | [features/business-tools/](./features/business-tools/) | [README.md](./features/business-tools/README.md) | [feature-logic-summary.md](./features/business-tools/feature-logic-summary.md) |

## Cross-feature concerns

| Concern | Primary areas | Notes |
|---------|---------------|-------|
| Google Sheets Time Log R/W | `timesheet`, `master-data` | `src/lib/google-sheets.ts` — in-process master cache 5 min |
| Zoho People | `auth`, `staff`, `holidays`, `reminders` | `src/lib/zoho-people.ts`, `src/lib/zoho/` |
| Redis | `staff`, `holidays`, `timesheet` | Leave TTL 21600s; holidays cache-aside TTL ~1 year (Zoho reload on miss); Time Log write lock on submit |
| NextAuth + middleware | `auth`, `layout` | Matcher: `/timesheet`, `/api/timesheet`, `/api/master`, `/api/staff` |
| Cron bearer secret | `reminders`, `holidays` | `Authorization: Bearer ${CRON_SECRET}` |
| Theme / view prefs | `layout` | `localStorage` keys `theme`, `timesheetViewMode` |
| Slack Timesheet AI Agent | `slack`, `timesheet`, `ai` | Events foundation: `src/lib/slack/*`; always-on AI-first NLU: `src/lib/ai/intent/*`; legacy regex helpers (non-production NL): `src/lib/ai/decision-engine.ts` |
| Tool Execution Foundation | `tools`, `ai`, `slack` | Vendor-agnostic tools: `src/lib/tools/*`; Conversation tool loop: `src/lib/ai/conversation.ts`; docs: `doc/features/tools/` |
| Business API Foundation | `business`, `tools` | Timesheet API HTTP client: `src/lib/business/*`; docs: `doc/features/business/` |
| Business Tools (read + confirmation-gated write) | `business-tools`, `tools`, `ai`, `timesheet` | Read tools + prepare/confirm/cancel write tools; pending store in `src/lib/timesheet/write/`; decision: `src/lib/ai/intent/` + `decision-engine.ts` + `write-decision.ts` |

### Source Code References

- `src/app/` — pages + API routes
- `src/components/` — timesheet UI
- `src/lib/` — server integrations
- `src/types/index.ts` — shared types
- `vercel.json` — Friday cron schedule `0 0 * * 5` (UTC)

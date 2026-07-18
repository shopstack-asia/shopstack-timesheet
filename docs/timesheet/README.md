# Shopstack Timesheet — System Documentation

**Purpose:** Source-of-truth documentation of the **existing** Shopstack Timesheet implementation, derived from source code. Intended for later design of Slack interaction, AI Timesheet Agent, MCP Server, automation, and integration APIs.

**This package does not design** Slack bots, MCP tools, or AI agents. It only documents what exists today.

---

## Source-of-truth policy

1. **Application source code** under `src/` is primary truth.
2. Existing docs under `doc/features/` are supporting context only.
3. When docs and code conflict, **code wins**; discrepancies are recorded in [19_GAPS_AMBIGUITIES_AND_TECHNICAL_DEBT.md](./19_GAPS_AMBIGUITIES_AND_TECHNICAL_DEBT.md).
4. Behavior not found in code is marked **Not implemented** or **Unclear** — never invented.

---

## Analysis metadata

| Field | Value |
|-------|-------|
| Analysis date | 2026-07-18 |
| Branch | `main` |
| Commit | `e8af4c6095ffcc6131f8beed890719bd3bc4d9ca` |
| Repository | `shopstack-timesheet` (this repo only) |
| App stack | Next.js 14 App Router, TypeScript, Tailwind, NextAuth, Google Sheets, Zoho People, Redis |

> Note: Working tree may include uncommitted changes relative to the commit above. Docs reflect **current workspace source** as of analysis.

---

## Scope covered

- Employee weekly timesheet UI (load, edit, copy, submit)
- Google Sheets Time Log persistence and master data (Projects, Roles and Tasks)
- Auth (Google OAuth `@shopstack.asia` + Zoho People staff profile)
- Leave display and full-day UI blocking (Zoho Leave)
- Holiday display (Zoho Holidays via Redis cache)
- Friday reminder cron (email + Slack)
- Redis leave/holiday cache and Time Log write lock
- Debug/probe routes and environment configuration

**Out of scope for this package:** designing future Slack/MCP/AI solutions; modifying application code.

---

## Repositories analyzed

| Repository | Module | Coverage | Evidence | Notes |
| ---------- | ------ | -------: | -------- | ----- |
| shopstack-timesheet | `src/app/` pages + API | Complete | 42 TS/TSX files under `src/` | Single monorepo app |
| shopstack-timesheet | `src/components/` | Complete | WeeklyTimesheet, DailyCard, TimeEntryForm, SearchableSelect | Client UI only |
| shopstack-timesheet | `src/lib/` | Complete | Sheets, Zoho, Redis, auth, leave, locks | Server integrations |
| shopstack-timesheet | `src/types/` | Complete | `src/types/index.ts` | No ORM entities |
| shopstack-timesheet | `doc/features/` | Supporting | Existing feature docs | Validated against code |
| Other Shopstack repos | — | Not Found | — | No sibling timesheet services in this workspace |

---

## Modules analyzed

| Module path | Role |
|-------------|------|
| `src/app/timesheet/` | Weekly timesheet page |
| `src/app/auth/` | Sign-in and auth error pages |
| `src/app/api/timesheet/` | Get / submit / holidays |
| `src/app/api/master/` | Projects and tasks |
| `src/app/api/staff/` | Profile and leave |
| `src/app/api/cron/` | Friday reminder, holiday refresh |
| `src/app/api/debug/` | Unauthenticated integration probes |
| `src/components/` | Timesheet UI |
| `src/lib/` | Sheets, Zoho, Redis, auth helpers |
| `src/middleware.ts` | Session gate for protected routes |
| `vercel.json` | Cron schedule |

---

## Documentation file index

| # | File | Contents |
|---|------|----------|
| — | [README.md](./README.md) | Index, coverage, completion report |
| 01 | [01_TIMESHEET_SYSTEM_OVERVIEW.md](./01_TIMESHEET_SYSTEM_OVERVIEW.md) | Purpose, boundaries, lifecycle |
| 02 | [02_FEATURE_INVENTORY.md](./02_FEATURE_INVENTORY.md) | Feature catalog |
| 03 | [03_USER_ROLES_AND_PERMISSIONS.md](./03_USER_ROLES_AND_PERMISSIONS.md) | Auth and access model |
| 04 | [04_BUSINESS_WORKFLOWS.md](./04_BUSINESS_WORKFLOWS.md) | Step-by-step workflows |
| 05 | [05_TIME_ENTRY_MANAGEMENT.md](./05_TIME_ENTRY_MANAGEMENT.md) | Entry fields and UX |
| 06 | [06_SUBMISSION_AND_APPROVAL.md](./06_SUBMISSION_AND_APPROVAL.md) | Submit model (no approval) |
| 07 | [07_VALIDATION_AND_BUSINESS_RULES.md](./07_VALIDATION_AND_BUSINESS_RULES.md) | Rules TS-BR-* |
| 08 | [08_PROJECT_TASK_AND_ASSIGNMENT_LOGIC.md](./08_PROJECT_TASK_AND_ASSIGNMENT_LOGIC.md) | Master data selection |
| 09 | [09_WORKING_TIME_AND_CALENDAR_RULES.md](./09_WORKING_TIME_AND_CALENDAR_RULES.md) | Leave, holidays, hours |
| 10 | [10_DATA_MODEL_AND_FIELD_DICTIONARY.md](./10_DATA_MODEL_AND_FIELD_DICTIONARY.md) | Sheets + TypeScript models |
| 11 | [11_API_AND_INTEGRATION_SPECIFICATION.md](./11_API_AND_INTEGRATION_SPECIFICATION.md) | Endpoints and integrations |
| 12 | [12_UI_SCREEN_AND_BEHAVIOR_SPECIFICATION.md](./12_UI_SCREEN_AND_BEHAVIOR_SPECIFICATION.md) | Screens |
| 13 | [13_NOTIFICATION_AND_BACKGROUND_PROCESSING.md](./13_NOTIFICATION_AND_BACKGROUND_PROCESSING.md) | Cron and reminders |
| 14 | [14_REPORTING_AND_EXPORT.md](./14_REPORTING_AND_EXPORT.md) | Reporting (not found) |
| 15 | [15_SECURITY_AUDIT_AND_COMPLIANCE.md](./15_SECURITY_AUDIT_AND_COMPLIANCE.md) | Security posture |
| 16 | [16_EDGE_CASES_AND_ERROR_HANDLING.md](./16_EDGE_CASES_AND_ERROR_HANDLING.md) | Edge cases |
| 17 | [17_TECHNICAL_ARCHITECTURE.md](./17_TECHNICAL_ARCHITECTURE.md) | Architecture |
| 18 | [18_CODE_TRACEABILITY_MATRIX.md](./18_CODE_TRACEABILITY_MATRIX.md) | Feature → code map |
| 19 | [19_GAPS_AMBIGUITIES_AND_TECHNICAL_DEBT.md](./19_GAPS_AMBIGUITIES_AND_TECHNICAL_DEBT.md) | Gaps and debt |
| 20 | [20_AI_MCP_READINESS_ASSESSMENT.md](./20_AI_MCP_READINESS_ASSESSMENT.md) | Future AI/MCP readiness |

---

## How to navigate

1. Start with **01** for system shape and actual lifecycle.
2. Use **02** + **18** to find features and code.
3. Use **07** for every validation rule.
4. Use **11** for API contracts when integrating.
5. Use **19** + **20** before designing Slack/MCP/AI layers.

Related engineering docs (not duplicated here): [`doc/features/`](../../doc/features/), [`doc/feature-logic-summary.md`](../../doc/feature-logic-summary.md).

---

## Known analysis limitations

- **No SQL/ORM database** — persistence is Google Sheets; schema inferred from sheet ranges and TypeScript types, not migrations.
- **Google Sheets live content** (actual project/task rows) was not inspected; only code that reads/writes sheets was analyzed.
- **Zoho live tenant data** was not queried; leave/holiday field mapping comes from code + types.
- **Only one repository** was available in this workspace; no separate payroll/billing/HR repos found.
- **Debug routes** lack authentication — documented as a security finding, not exercised against production.

---

## High-level completeness assessment

| Area | Assessment |
|------|------------|
| Employee self-service timesheet | **Complete** — end-to-end traced |
| Approval / manager workflow | **Not implemented** |
| Roles / RBAC | **Not implemented** (domain + Zoho employee only) |
| Reporting / export | **Not implemented** |
| Background jobs | **Partial** — Friday reminder + holiday refresh |
| Tests | **Partial** — 2 Vitest unit suites for helpers |

**Overall documentation confidence:** High for implemented employee flows; High that approval/reporting/RBAC are absent; Medium for Sheets operational edge cases not covered by automated tests.

---

## Completion report

```text
Repositories analyzed: 1 (shopstack-timesheet)
Modules analyzed: pages, components, api (timesheet/master/staff/cron/debug/auth), lib, types, middleware, vercel.json, env example
Files inspected: 42 TypeScript/TSX source files under src/ + config + existing doc/features
Timesheet features identified: ~18 implemented feature IDs (see 02)
APIs identified: 16 route modules (auth catch-all, 3 timesheet, 2 master, 4 staff, 2 cron, 4 debug)
Database entities identified: 0 RDBMS tables; 3 Google Sheets tabs (Projects, Roles and Tasks, Time Log) + Redis keys
Business rules identified: TS-BR-001 … TS-BR-020+ (see 07)
User roles identified: 1 effective role (authenticated Shopstack employee); cron service via Bearer secret
Workflows identified: load week, edit, copy yesterday, submit day/week, custom project create, leave/holiday UX, Friday reminder
Background jobs identified: 2 (friday-reminder scheduled; refresh-holidays unscheduled)
Integrations identified: Google OAuth, Google Sheets, Zoho People, Redis, Slack (optional), SMTP (optional)
Automated tests identified: 2 files (sheets-write-lock, submit-week-days)
Unresolved ambiguities: leave ApprovalStatus not filtered; holiday edit still allowed; empty-day delete only via empty submit body (UI never sends empty days)
Critical risks: unauthenticated debug routes; no timesheet approval; leave blocking frontend-only; Sheets as concurrent datastore mitigated only by Redis write lock
Overall documentation confidence: High for current implementation; gaps explicitly marked Not implemented
```

## Analysis Coverage

```text
Frontend: Complete
Backend: Complete
Database: Complete (Sheets + Redis as persistence/cache; no RDBMS)
Permissions: Complete (simple model fully documented)
Tests: Partial
Integrations: Complete (within this repo)
Background Jobs: Complete
Reporting: Not Found
```

## Blocking Information Gaps

- Live Google Spreadsheet contents and operational ownership process
- Zoho leave approval policy expected by business (code does not filter by `ApprovalStatus`)
- Any external reporting/billing consumers of the Time Log sheet (outside this repo)

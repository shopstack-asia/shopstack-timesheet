# 14 — Reporting and Export

**Confidence:** Confirmed by code — **Not implemented** in application

---

## Available reports

**None** in this repository. No report pages, no aggregation APIs, no CSV/Excel/PDF export routes or libraries (beyond what Sheets itself provides externally).

---

## What exists that might feed external reporting

| Data | Location | Notes |
|------|----------|-------|
| Time Log sheet | Google Sheets `Time Log!A:M` | Denormalized staff, project, task, hours by date |
| Projects / Tasks | Sheets tabs | Master data |
| Week total in UI | Client `weekTotalHours` | Display only; not exported |

Any client/project/department/billable/overtime/approval/missing-timesheet report would be built **outside** this app (e.g. Sheets pivots, Looker, manual) — **Not found** here.

---

## Filters / export formats / aggregation

**Not found.**

---

## Permission restrictions for reports

**N/A** — no report module. Note: every authenticated employee can read the **full** Projects/Tasks catalogs; Time Log API returns only own rows, but the underlying spreadsheet sharing may allow broader human access.

---

## Calculation logic in app

| Metric | Logic | Where |
|--------|-------|-------|
| Day total | Sum of entry.hours | WeeklyTimesheet / DailyCard |
| Week total | Sum of day totals | WeeklyTimesheet |

No billable split, overtime calc, or approval metrics.

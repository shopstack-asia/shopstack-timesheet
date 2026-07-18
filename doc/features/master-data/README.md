# Master data — feature area

## Purpose

Serve Projects and Tasks from Google Sheets to the timesheet UI, with short in-process caching.

## Scope

- `src/app/api/master/projects/route.ts`
- `src/app/api/master/tasks/route.ts`
- `getCachedProjects` / `getCachedTasks` / `clearSheetsCache` in `src/lib/google-sheets.ts`

## Reading order

1. This README
2. [domain-features.md](./domain-features.md)
3. [feature-logic-summary.md](./feature-logic-summary.md)
4. [features/](./features/)
5. Code

# Layout — feature area

## Purpose

App shell: root redirect, providers, middleware-protected routes, and theme. Shared header and module navigation live in the workspace area. The timesheet page keeps week navigation and the column/tab view preference.

## Scope

- `src/app/layout.tsx`, `providers.tsx`, `page.tsx`
- `src/middleware.ts`
- `src/app/(workspace)/timesheet/page.tsx` (week chrome only; grid logic is `timesheet`; header is `workspace`)
- `src/contexts/ThemeContext.tsx`

## Reading order

1. This README
2. [domain-features.md](./domain-features.md)
3. [feature-logic-summary.md](./feature-logic-summary.md)
4. [features/](./features/)
5. Code

# Layout — feature area

## Purpose

App shell: root redirect, providers, middleware-protected routes, timesheet page chrome (week nav, sign-out), dark/light theme, and column/tab view preference.

## Scope

- `src/app/layout.tsx`, `providers.tsx`, `page.tsx`
- `src/middleware.ts`
- `src/app/timesheet/page.tsx` (shell only; grid logic is `timesheet`)
- `src/contexts/ThemeContext.tsx`

## Reading order

1. This README
2. [domain-features.md](./domain-features.md)
3. [feature-logic-summary.md](./feature-logic-summary.md)
4. [features/](./features/)
5. Code

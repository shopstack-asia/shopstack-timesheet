# Layout — domain features

## Capabilities

1. **Root routing** — unauthenticated `/` → `/auth/signin`; authenticated → `/timesheet`.
2. **Providers** — `ThemeProvider` wrapping `SessionProvider`.
3. **Middleware** — NextAuth protects `/timesheet` and `/api/timesheet|master|staff`.
4. **Timesheet shell** — week prev/current/next, staff name, theme toggle, sign-out, view mode toggle persistence.
5. **Theme** — light/dark via `localStorage` key `theme` + `document.documentElement` class `dark`; system preference if unset.

## Dependencies

- NextAuth session (auth area)
- Tailwind `dark:` variants

## Non-obvious constraints

- Middleware does **not** cover `/api/cron/*` or `/api/debug/*` (cron uses bearer; debug has no auth — see `ops`).
- View mode stored as `timesheetViewMode` (`column` | `tab`).

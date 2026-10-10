# Layout — domain features

## Capabilities

1. **Root routing** — unauthenticated `/` → `/auth/signin`; authenticated → `/timesheet` (unchanged landing). Dashboard is a separate nav destination.
2. **Providers** — `ThemeProvider` wrapping `SessionProvider`.
3. **Middleware** — NextAuth protects `/timesheet`, `/dashboard`, `/expense`, `/settings`, and `/api/timesheet|master|staff|expense|workspace|settings`.
4. **Workspace shell** — application name, module navigation, staff name, theme toggle, and sign-out. Owned by `workspace`.
5. **Timesheet week chrome** — week prev/current/next and view mode persistence stay on `/timesheet`.
6. **Theme** — light/dark via `localStorage` key `theme` + `document.documentElement` class `dark`; system preference if unset.

## Dependencies

- NextAuth session (auth area)
- Tailwind `dark:` variants

## Non-obvious constraints

- Middleware does **not** cover `/api/cron/*` or `/api/debug/*` (cron uses bearer; debug has no auth — see `ops`).
- View mode stored as `timesheetViewMode` (`column` | `tab`).

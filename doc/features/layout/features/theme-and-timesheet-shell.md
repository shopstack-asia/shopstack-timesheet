# Theme and timesheet shell

### Overview

Timesheet page chrome: week navigation, staff display, sign-out, dark mode toggle, and column vs tab view preference.

### Business Purpose

Provide navigation and personal preferences around the weekly grid without owning time-entry business rules.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff | `/timesheet` shell | Navigate weeks, toggle theme/view, sign out |

### Workflow

1. Load theme from `localStorage.theme` or system preference; apply `dark` class on `<html>`.
2. Load `timesheetViewMode` (`column`|`tab`); persist on change.
3. Week controls adjust `currentWeek`; `weekStart = startOfWeek(..., { weekStartsOn: 1 })` passed to `WeeklyTimesheet`.
4. Sign-out → `/auth/signin`.

### Screen Behavior

- Nav: title, staff First+Last name, theme button, Sign Out.
- Week: Previous / Current / Next.
- View mode controls (wired into `WeeklyTimesheet` via props).

### Business Logic

- Theme toggle flips light ↔ dark and writes `localStorage`.
- View mode invalid stored values ignored; default `column`.

### Data Model Summary

- Client-only prefs: `theme`, `timesheetViewMode`.

### Known Limitations

- Theme fallback when outside provider returns no-op toggles (safe default light).

### Source Code References

- `src/contexts/ThemeContext.tsx`
- `src/app/timesheet/page.tsx`
- `src/app/providers.tsx`
- `src/app/layout.tsx`

### Required tests

- Theme persistence key `theme`
- View mode persistence key `timesheetViewMode`
- Week start uses Monday

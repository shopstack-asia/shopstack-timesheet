# Leave and holiday day UX

### Overview

Daily cards and tab labels reflect holidays and Zoho leave. Staff may still log time on holidays, weekends, and half-day leave; only **FULL** leave disables add/edit.

### Business Purpose

Surface leave/holiday context while allowing overtime or holiday work logging. Block only full leave days where the staff member is not expected to work.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff | Timesheet UI | See leave/holiday cues; blocked add/edit when FULL leave only |

### Workflow

1. Leave loaded via monthly API; holidays via holidays API.
2. Helpers: `isFullLeave`, `isHalfLeave`, `getLeaveEntry` from `src/lib/leave-utils.ts`.
3. Holiday present when holiday entry exists (`is_holiday` or truthy entry).
4. `disabled={isFull}` on add entry and entry forms — holidays do **not** disable.
5. HALF leave: yellow styling; editing still allowed.
6. Leave info panel / holiday banner on the card (visual only for holidays).

### Screen Behavior

| State | Border / cue | Add/Edit |
|-------|----------------|----------|
| Holiday | Red / 🎉 | Enabled |
| FULL leave | Orange / 🚫 | Disabled |
| HALF leave | Yellow | Enabled |
| Weekend (Sat/Sun) | Default (unless leave/holiday) | Enabled |
| Normal weekday | Default | Enabled |

### Business Logic

- Leave type from Zoho LeaveCount: `>= 1` → FULL else HALF (staff area).
- Holiday list Redis-backed (holidays area); UI may skip fetch without location.
- Week UI is Monday–Sunday; weekends are editable like weekdays.

### Edge Cases

- ApprovalStatus from Zoho is stored but **not filtered** to Approved-only in normalizer — Pending leave may affect UI if returned by Zoho for the employee query.
- Copy Yesterday is hidden when FULL leave; holidays no longer hide it.

### Source Code References

- `src/components/DailyCard.tsx`
- `src/components/WeeklyTimesheet.tsx` (tab colors)
- `src/lib/leave-utils.ts`

### Required tests

- FULL leave disables add/edit
- Holiday does **not** disable add/edit
- HALF does not disable
- Tab class selection for holiday vs leave

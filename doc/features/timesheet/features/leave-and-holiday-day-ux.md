# Leave and holiday day UX

### Overview

Daily cards and tab labels reflect holidays and Zoho leave so staff avoid logging on non-working full days.

### Business Purpose

Reduce incorrect time entry on holidays and full leave days while allowing half-day leave logging.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff | Timesheet UI | See leave/holiday cues; blocked add/edit when FULL/holiday |

### Workflow

1. Leave loaded via monthly API; holidays via holidays API.
2. Helpers: `isFullLeave`, `isHalfLeave`, `getLeaveEntry` from `src/lib/leave-utils.ts`.
3. Holiday present when holiday entry exists (`is_holiday` or truthy entry).
4. `disabled={isFull || isHoliday}` on add entry and entry forms.
5. HALF leave: yellow styling; editing still allowed.
6. Leave info panel / holiday banner on the card.

### Screen Behavior

| State | Border / cue | Add/Edit |
|-------|----------------|----------|
| Holiday | Red / 🎉 | Disabled |
| FULL leave | Orange / 🚫 | Disabled |
| HALF leave | Yellow | Enabled |
| Normal | Default | Enabled |

### Business Logic

- Leave type from Zoho LeaveCount: `>= 1` → FULL else HALF (staff area).
- Holiday list Redis-backed (holidays area); UI may skip fetch without location.

### Edge Cases

- ApprovalStatus from Zoho is stored but **not filtered** to Approved-only in normalizer — Pending leave may affect UI if returned by Zoho for the employee query.
- Copy Yesterday not gated on FULL leave (only holiday).

### Source Code References

- `src/components/DailyCard.tsx`
- `src/components/WeeklyTimesheet.tsx` (tab colors)
- `src/lib/leave-utils.ts`

### Required tests

- FULL + holiday disable add/edit
- HALF does not disable
- Tab class selection for holiday vs leave

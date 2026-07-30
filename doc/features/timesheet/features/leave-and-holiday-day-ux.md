# Leave and holiday day UX

### Overview

Daily cards and tab labels reflect holidays and Zoho leave. Staff may log time on holidays, weekends, **FULL** leave, and half-day leave. Leave and holiday cues are visual only for editing; submit still requires acknowledgement where policy applies.

### Business Purpose

Surface leave/holiday context while allowing overtime, holiday work, or work logged on a leave day. Do not block entry forms; rely on submit-time ack for full leave and holidays.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff | Timesheet UI | See leave/holiday cues; add/edit/copy on all day types including FULL leave |

### Workflow

1. Leave loaded via monthly API; holidays via holidays API.
2. Helpers: `isFullLeave`, `isHalfLeave`, `getLeaveEntry` from `src/lib/leave-utils.ts`.
3. Holiday present when holiday entry exists (`is_holiday` or truthy entry).
4. Add entry and entry forms are enabled on FULL leave and holidays (disabled only while `submitting`).
5. HALF leave: yellow styling; editing allowed.
6. Leave info panel / holiday banner on the card (visual only).
7. On **Submit Week**, server may return `LEAVE_OVERRIDE_REQUIRED` / `HOLIDAY_ACK_REQUIRED`; UI confirms and retries with ack flags.

### Screen Behavior

| State | Border / cue | Add/Edit |
|-------|----------------|----------|
| Holiday | Red / 🎉 | Enabled |
| FULL leave | Orange / 🚫 | Enabled |
| HALF leave | Yellow | Enabled |
| Weekend (Sat/Sun) | Default (unless leave/holiday) | Enabled |
| Normal weekday | Default | Enabled |

### Business Logic

- Leave type from Zoho LeaveCount: `>= 1` → FULL else HALF (staff area).
- Holiday list Redis-backed (holidays area); UI may skip fetch without location.
- Week UI is Monday–Sunday; weekends are editable like weekdays.
- Submit policy still requires leave OVERRIDE ack for FULL leave days and holiday ack for holidays (see weekly-submit doc).

### Edge Cases

- ApprovalStatus from Zoho is stored but **not filtered** to Approved-only in normalizer — Pending leave may affect UI cues if returned by Zoho for the employee query.
- Copy Yesterday is shown on empty Tue–Sun days including FULL leave and holidays.

### Source Code References

- `src/components/DailyCard.tsx`
- `src/components/WeeklyTimesheet.tsx` (tab colors; submit ack confirm)
- `src/lib/leave-utils.ts`
- `src/lib/timesheet-agent/guardrails.ts` (leave OVERRIDE / holiday ack)

### Required tests

- FULL leave does **not** disable add/edit
- Holiday does **not** disable add/edit
- HALF does not disable
- Tab class selection for holiday vs leave
- Submit on FULL leave prompts leave override ack (existing submit-week / policy tests)

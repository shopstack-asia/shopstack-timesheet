# 09 — Working Time and Calendar Rules

**Confidence:** Confirmed by code; distinctions marked Configured / Hard-coded / Derived / Missing

---

## Standard working day / week

| Topic | Behavior | Kind |
|-------|----------|------|
| Week definition | Monday–Sunday in UI | Hard-coded (`weekStartsOn: 1`) |
| Standard hours/day | None enforced | Missing |
| Standard hours/week | None enforced | Missing |
| Reminder copy | Email/Slack say “Monday - Friday” | Hard-coded messaging only |
| `isWeekday` helper | Exists in `utils.ts` | Hard-coded helper; **unused** by submit/UI |

---

## Employee-specific working hours / shifts / flexible hours

**Missing** — Not implemented.

---

## Weekend rules

Weekend days appear as normal day cards. No block on add/submit. **Missing** business weekend rule.

---

## Public / company holidays

| Aspect | Behavior | Kind |
|--------|----------|------|
| Source | Zoho yearly holidays API via `getYearlyHolidays` | Integration |
| Cache | Redis `holiday:{location}:{year}` TTL ~1 year | Configured TTL hard-coded |
| Location | Session `staffProfile.Location` or env defaults | Configured + derived |
| UI | Red border/banner; tab button styling | Hard-coded UX |
| Edit/submit | **Still allowed** | Missing enforcement |
| Refresh | Cron friday-reminder + `/api/cron/refresh-holidays` | Implemented |

Holiday read API reads **cache only**; if empty/missing, returns error asking admin to refresh — does not live-fetch Zoho on GET.

---

## Leave integration

| Aspect | Behavior | Kind |
|--------|----------|------|
| Source | Zoho Leave API v2 `fetchLeaveRecords(employeeId, from, to)` | Integration |
| Cache | Redis `leave:{id}:{from}:{to}` TTL **21600s** (6h) | Hard-coded |
| Normalize | Expand `Days` map → FULL/HALF | Derived |
| Full day UI | Disable add/edit/delete | Hard-coded frontend |
| Half day UI | Warning banner; editing allowed | Hard-coded frontend |
| ApprovalStatus | Stored on entry; **not filtered** | Gap / Missing filter |
| Server submit | Does not consult leave | Missing enforcement |
| Partial leave hours deduction | Not calculated | Missing |

Legacy attendance-based leave parsers exist in `leave-utils.ts` for backward compatibility; monthly API uses v2 normalize path.

---

## Overtime calculation

**Missing.**

---

## Break handling

**Missing.**

---

## Time zone handling

| Layer | Behavior |
|-------|----------|
| Week dates | Browser local `Date` + `date-fns` |
| Cron schedule | UTC (`0 0 * * 5`) |
| Sheets dates | Normalized to YYYY-MM-DD with heuristics |
| Explicit TZ config | Not found |

DST: **Undefined** beyond JS Date behavior.

---

## Working calendar source

Zoho People holidays + Zoho leave — not an internal calendar table.

---

## Calendar exceptions / cross-midnight shifts

**Missing.** Hours-only model; no shifts.

---

## Summary matrix

| Rule area | Configured | Hard-coded | Derived | Missing |
|-----------|------------|------------|---------|---------|
| Week Mon–Sun | | ✓ | | |
| 8h day / 40h week | | | | ✓ |
| Weekend block | | | | ✓ |
| Holiday display | location env | ✓ styling | from Zoho | server block |
| Leave full-day UI block | | ✓ | from Zoho | server block + Approved filter |
| Overtime | | | | ✓ |
| TZ policy | | cron UTC | | product TZ |

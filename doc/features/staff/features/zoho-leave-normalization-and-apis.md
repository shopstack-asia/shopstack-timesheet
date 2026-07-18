# Zoho leave normalization and APIs

### Overview

Leave records from Zoho People Leave API v2 are filtered by EmployeeID, cached in Redis, and normalized into per-day FULL/HALF entries for the timesheet.

### Business Purpose

Show leave context and block FULL leave days in the weekly UI.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff with EmployeeID | `/api/staff/leave*` | Read own leave |
| Missing EmployeeID in session | 404 | — |

### Workflow

1. Validate session + EmployeeID.
2. Resolve date range (range defaults, or monthly/yearly params).
3. Try Redis cache; on miss call Zoho Leave API v2 filtered by EmployeeId.
4. `normalizeZohoLeaveRecords` expands `Days` keys into `LeaveDayEntry[]`.
5. Cache result (TTL 21600 seconds where implemented).

### Use Cases

- Monthly leave for weeks spanning a month (UI)
- Arbitrary range / yearly (API available)

### Business Logic

From `normalizeZohoLeaveRecords`:

- Skip records without `Days` object.
- Per date key: `LeaveCount >= 1.0` → `type: 'FULL'` else `HALF`.
- HALF + Session `1` → `dayType: FIRST_HALF`; `2` → `SECOND_HALF`; else `HALF_DAY`.
- FULL → `dayType: FULL_DAY`.
- Copy `Leavetype`, `Reason`, `ApprovalStatus` as `leaveType` / `reason` / `status`.
- Invalid date keys skipped with warning.

Helpers used by UI: `isFullLeave`, `isHalfLeave`, `getLeaveEntry`.

### Validation Rules

- Monthly: year ≥ 2000; month query 1–12 (converted to 0-index internally).
- Range/yearly: see respective routes for defaults.

### Edge Cases

- **No status filter** — Pending/Cancelled may appear if Zoho returns them for the query.
- Redis unavailable: behavior depends on `getRedisClient` (may fall through to Zoho — confirm in redis module when changing).

### API and Integration Behavior

| Route | Query | UI |
|-------|-------|-----|
| `GET /api/staff/leave` | `from`, `to` optional | Unused |
| `GET /api/staff/leave/monthly` | `year`, `month` | **Used** |
| `GET /api/staff/leave/yearly` | `year` | Unused |

- Upstream: Zoho People Leave API v2 (server-only).

### Data Model Summary

- `LeaveDayEntry`, `ZohoLeaveRecord`, `ZohoLeaveApiResponse`.

### Source Code References

- `src/lib/leave-utils.ts`
- `src/app/api/staff/leave/monthly/route.ts`
- `src/app/api/staff/leave/route.ts`
- `src/app/api/staff/leave/yearly/route.ts`
- `src/lib/zoho-people.ts`

### Required tests

- FULL vs HALF from LeaveCount
- Session 1/2 dayType mapping
- Skip missing Days / bad dates
- Monthly 400 on invalid month
- 404 without EmployeeID

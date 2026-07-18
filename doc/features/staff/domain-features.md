# Staff — domain features

## Capabilities

1. **Profile** — return `session.staffProfile` (404 if missing).
2. **Leave (range)** — `from`/`to` query; default ~±3 months; Redis cache key `leave:{employeeId}:{from}:{to}` TTL 21600s.
3. **Leave monthly** — `year` + `month` (1–12); builds month date range; same normalize + Redis pattern; **used by UI**.
4. **Leave yearly** — full calendar year; unused by current UI.
5. **Normalization** — Zoho Leave API v2 `Days` object → `LeaveDayEntry` FULL/HALF with session halves.

## Dependencies

- Auth session with `EmployeeID`
- Zoho Leave API v2
- Optional Redis

## Non-obvious constraints

- ApprovalStatus is copied through; **no Approved-only filter** in `normalizeZohoLeaveRecords`.
- Legacy attendance parsers in leave-utils are not on the live Leave API v2 path.

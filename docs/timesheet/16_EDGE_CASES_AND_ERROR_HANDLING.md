# 16 — Edge Cases and Error Handling

**Confidence:** Confirmed by code or marked **Undefined**

---

## Edge case table

| Edge Case | Current Behavior | Expected From Code | Risk | Source |
| --------- | ---------------- | ------------------ | ---- | ------ |
| Duplicate submission same day/project/task | Upsert updates hours | Same | Low (intended) | google-sheets appendOrUpdate |
| Duplicate Time Log IDs on read | Skip extras with warn | Dedupe in GET | Data quality | get route seenIds |
| Two UI rows same project+task | Last upsert wins (one sheet row) | Collapse on submit | User confusion | Time Log ID design |
| Overlapping time ranges | N/A — hours only | Undefined | — | — |
| More than 24 hours one day (sum) | Allowed | No daily sum check | High | submit Zod per entry only |
| Single entry hours > 24 | Rejected Zod / UI max | Reject | Low | Zod max 24 |
| Entry hours = 0 via API | Accepted | Allowed by Zod | Medium | Zod min 0 vs UI >0 |
| Midnight crossing | N/A | Undefined | — | — |
| Entry on holiday | Allowed UI+API | Allowed | Medium vs policy | DailyCard / submit |
| Entry during full leave | UI blocked; API allowed | Frontend-only block | High | DailyCard vs submit |
| Entry before employment / after termination | Allowed if can sign in | Zoho gate at sign-in only | Medium | auth.ts |
| Inactive/archived project | Allowed if in sheet | Undefined archive | Medium | no status field |
| Inactive task | 400 if removed from sheet | Invalid task ID | Low | submit |
| Concurrent two users submit | Serialized by Redis lock | Wait or 503 | Medium | sheets-write-lock |
| Lock wait timeout | 503 “Timesheet is busy…” | Retry | Medium | submit catch |
| Redis unavailable on submit | 503 lock unavailable | Fail closed | High for writes | SheetsWriteLockError |
| Partial week submit failure | Other days still written | Continue sequence | High (partial week) | submitWeekDaysSequentially |
| Clear all entries for a day then Submit Week | Empty day skipped — **Sheets rows remain** | No delete POST | **High** | filter entries.length>0 |
| Empty entries array POST | Deletes all day rows | Documented in submit | Medium | submit route |
| Network retry duplicate POST | Upsert same IDs — mostly safe | Idempotent-ish | Low | Time Log ID |
| Custom project name collision | New numeric IDs each create; names can duplicate | Allows duplicate names | Medium | createProject |
| Stale master cache (5 min) | May miss brand-new projects until TTL/clear | Eventual | Low | getCachedProjects |
| Holiday cache empty | Holidays API 500 message | Must run refresh cron | Medium | holidays route |
| Leave includes Pending/Cancelled | Still may FULL-block UI | No ApprovalStatus filter | High | leave-utils |
| Manager removed | N/A — no manager flow | Undefined | — | — |
| DST / timezone shift on week bounds | Browser local Date | Undefined policy | Medium | timesheet page |
| Debug endpoints exposed | Callable without auth | Open probes | Critical | api/debug/* |
| Non-Shopstack email | Sign-in denied | Deny | Low | auth.ts |
| Zoho employee missing | Sign-in denied | Deny | Low | auth.ts |

---

## Error response patterns

| Layer | Pattern |
|-------|---------|
| API | `{ success: false, error: string }` + HTTP status |
| UI submit | `alert(...)` with messages |
| UI load failures | console.error; leave/holidays soft degrade |

---

## Unimplemented edge policies

Marked **Undefined** where product policy is not encoded: employment dates, archive rules, holiday prohibition, approved-leave-only, daily caps, manager lifecycle.

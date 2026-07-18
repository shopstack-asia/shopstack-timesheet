# 06 — AI Integration Risks

How the **backend (and UI where noted)** currently handles each risk case.  
No assumptions about desired policy beyond code.

---

## Duplicate prevention

| Aspect | Current handling |
|--------|------------------|
| Same date + staff + project + task | `generateTimeLogId` + `findExistingTimeLogEntry` → **update** existing row (upsert) |
| Two UI rows same project+task same day | Collapse to one Sheets row on submit (same ID) |
| Duplicate Time Log IDs on read | GET skips duplicates via `seenIds` + console.warn |
| Client idempotency key | **Not found** |
| Retry same POST | Generally safe for same payload (upsert); dangerous if second payload omits keys (deletes) |

---

## Invalid hours

| Case | Handling |
|------|----------|
| `hours < 0` or `> 24` | Zod rejects → 400 |
| `hours === 0` | **Accepted by API**; UI submit requires `hours > 0` |
| Non-number | Zod fails |
| Sum of entries > 24 for one day | **Allowed** — no daily total validation |
| UI input | `min=0` `max=24` `step=0.25` |

---

## Future date

| Aspect | Handling |
|--------|----------|
| Submit future `date` | **Allowed** — only format validated |
| UI week navigation | Allows next weeks |
| Cut-off / lock future periods | **Not found** |

---

## Past date / closed period

| Aspect | Handling |
|--------|----------|
| Past dates | **Allowed** |
| Closed / locked payroll period | **Not found** — no period lock entity |
| Redis lock | Technical write serialization only (TTL 90s), not business close |

---

## Submitted week

| Aspect | Handling |
|--------|----------|
| Status “Submitted” | **Not found** — no status field |
| Re-submit after write | **Allowed** — upsert/delete again |
| Recall | **Not found** |
| UI “Submit Week” | Means persist to Sheets |

---

## Permission violation

| Case | Handling |
|------|----------|
| No session | 401 Unauthorized |
| Session without staffProfile on get/submit | 401 |
| Submit as another EmployeeID | **Impossible via body** — staff fields taken from session only |
| Read another employee’s time log via get API | Filtered out (only own Staff ID) |
| Manager approve others | **No API** |
| Cron without Bearer | 401 |
| Debug routes | **No auth** — anyone who can hit the URL |

Middleware protects `/api/timesheet`, `/api/master`, `/api/staff` with NextAuth session.

---

## Missing project

| Case | Handling |
|------|----------|
| `projectId` empty | Zod min(1) → 400 |
| `projectId` not in Projects sheet | Treated as **custom name** → `createProject` (not an error) |
| createProject failure | 500 with error message |
| UI requires client then project | Frontend only |

**AI risk:** Misspelled project ID creates a **new** Projects row instead of failing.

---

## Missing task

| Case | Handling |
|------|----------|
| Empty taskId | Zod → 400 |
| Unknown taskId | **400** `Invalid task ID: …` |
| Task removed from sheet after UI load | Submit fails 400 |

---

## Leave day writes

| Case | Handling |
|------|----------|
| Full leave — UI | Add/edit/delete disabled |
| Full leave — API | **No check** — submit succeeds |
| Half leave | UI editable; API no check |
| ApprovalStatus Pending/Cancelled | Still normalized into leave list; may FULL-block UI |

---

## Holiday day writes

| Case | Handling |
|------|----------|
| UI | Visual only |
| API | **No check** |

---

## Concurrent writes

| Case | Handling |
|------|----------|
| Parallel submits | `withTimeLogWriteLock` — wait up to 45s or 503 |
| Redis down | 503 “write lock unavailable” |
| Partial multi-day week submit | Failures do not roll back successful earlier days |

---

## Empty day / accidental delete

| Case | Handling |
|------|----------|
| `entries: []` | Deletes all Time Log rows for date+staff |
| Week UI skips empty days | Does **not** delete cleared days |
| Omit one Project\|Task key | Deletes that row only |

**AI risk:** Day-replace tools can wipe a day if they send incomplete entry lists or empty arrays unintentionally.

---

## Invalid date format

Zod `/^\d{4}-\d{2}-\d{2}$/` → 400. No calendar validity check beyond regex (e.g. `2026-13-40` may pass regex — **Confirmed:** Zod only uses the regex shown in submit schema, not `date-fns` parse).

---

## Summary for AI designers (findings only)

| Risk | Backend protects? |
|------|-------------------|
| Duplicate same key | Upsert (yes, soft) |
| Hours out of 0–24 | Yes |
| Hours = 0 | No (allowed) |
| Daily > 24 sum | No |
| Future/past/closed period | No |
| Submitted lock | No |
| Cross-user write | Yes (session binding) |
| Missing task | Yes (400) |
| Missing project ID | No — creates project |
| Leave/holiday | No (server) |
| Accidental day wipe | Partial — by design of replace API |

No implementation proposed in this document.

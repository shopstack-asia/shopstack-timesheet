# 03 — AI Candidate Operations

Ratings reflect **fit of existing backend capabilities** for an AI agent (not product priority).  
Scale: ★☆☆☆☆ (unsuitable / missing) → ★★★★★ (clear, API-backed, low ambiguity).

---

## Rated candidates

### ★★★★★ Get current employee profile

**Reason:** Single read API (`GET /api/staff/profile`) or session; fixed `StaffProfile` shape; no write risk.

---

### ★★★★★ Get weekly timesheet

**Reason:** Single API `GET /api/timesheet/get?weekStart=`; returns structured entries by date; scoped to session user.

---

### ★★★★★ List projects (and clients)

**Reason:** Single API `GET /api/master/projects`; deterministic IDs (`ProjectID`); clients included.  
**Caveat for AI:** No search endpoint — agent must filter client-side; catalog is global (not assignment-scoped).

---

### ★★★★★ List tasks

**Reason:** Single API `GET /api/master/tasks`; `TaskID` is authoritative.  
**Caveat:** No project–task linkage; all tasks valid for any project per backend.

---

### ★★★★☆ Get leave for month/range

**Reason:** Clear APIs (`/api/staff/leave/monthly`, `/leave`, `/yearly`); normalized `LeaveDayEntry`.  
**Deduction:** `ApprovalStatus` not filtered — AI may treat Pending leave as blocking if it mirrors UI.

---

### ★★★★☆ Get holidays

**Reason:** `GET /api/timesheet/holidays`.  
**Deduction:** Redis-cache-only; empty cache → error; not live Zoho on read.

---

### ★★★★☆ Persist day / “create or update entries for a date”

**Reason:** One write API with Zod validation and upsert semantics; Redis lock reduces race damage.  
**Deduction:** Not single-entry CRUD — payload is **full day replacement set**; omitting keys deletes; easy for AI to wipe unintended rows. Hours `0` allowed server-side. Leave/holiday not enforced server-side.

---

### ★★★☆☆ Submit week

**Reason:** Exists as **client loop** over day submit, not one backend “submit week” API.  
**Deduction:** Agent must orchestrate N POSTs; partial failure leaves inconsistent week; empty days skipped (cannot clear via week orchestration as UI does). No approval semantics despite the word “submit”.

---

### ★★☆☆☆ Create time entry (as users conceive it)

**Reason:** No create-entry API; draft is client-only. Mapping to submit requires loading current day, merging, and replacing — high foot-gun without careful tool design. Custom project create is implicit.

---

### ★★☆☆☆ Update / delete single entry

**Reason:** Only via day-replace submit. Requires read-merge-write. Delete-all-empty-day needs explicit `entries: []` which UI week flow does not use.

---

### ★★☆☆☆ Copy previous day

**Reason:** Client-only; no API. AI can emulate by reading week and writing day — possible but not a first-class operation.

---

### ★☆☆☆☆ Draft save

**Reason:** **Not implemented** server-side.

---

### ★☆☆☆☆ Recall submission

**Reason:** **Not implemented.**

---

### ★☆☆☆☆ Approve / Reject

**Reason:** **Not implemented** — no APIs, roles, or statuses. Unsuitable until product APIs exist.

---

### ★☆☆☆☆ Weekly summary / reporting / missing hours

**Reason:** No reporting API; no standard-hours rules in backend. Agent could sum `GET` data locally — that is **derived**, not a backend operation. Missing-hours detection is **not** in code (Friday reminder is a blast, not analysis).

---

### ★☆☆☆☆ Copy previous week

**Reason:** **Not implemented.**

---

## Summary table

| Operation | Rating | Backend support |
|-----------|:------:|-----------------|
| Get profile | ★★★★★ | Direct API |
| Get week | ★★★★★ | Direct API |
| List projects | ★★★★★ | Direct API (no search) |
| List tasks | ★★★★★ | Direct API (no search) |
| Get leave | ★★★★☆ | Direct API |
| Get holidays | ★★★★☆ | Direct API (cache) |
| Persist day (submit) | ★★★★☆ | Direct API; replace semantics |
| Submit week | ★★★☆☆ | Client orchestration only |
| Single entry CRUD | ★★☆☆☆ | Emulate via day replace |
| Copy yesterday | ★★☆☆☆ | Client-only / emulate |
| Draft / recall | ★☆☆☆☆ | Missing |
| Approve / reject | ★☆☆☆☆ | Missing |
| Reports / missing hours | ★☆☆☆☆ | Missing |

---

## Guidance (discovery only)

Highest-confidence AI surface today is **read APIs + carefully constrained day persist**.  
Write tools that assume entry-level CRUD, drafts, approval, or period locks **are not backed by current code**.

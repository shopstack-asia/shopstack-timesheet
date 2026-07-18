# 03 — Information Collection

Per-intent information classes. Traceable to UI (`TimeEntryForm`, `WeeklyTimesheet`) and API (`submit` Zod, Sheets mapping).

---

## Global auto-filled (all authenticated ops)

| Field | Source | Notes |
|-------|--------|-------|
| EmployeeID, name, position | Session / `get_current_employee` | Submit overwrites staff columns from session |
| Email domain | Auth gate `@shopstack.asia` | Not collected in chat |

**Department:** Not in codebase — never collect or invent.

---

## INT-001 / INT-002 / INT-003 — Add / update entry

| Class | Fields |
|-------|--------|
| **Required** | Date (YYYY-MM-DD after resolve); Project identity; Task identity; Hours (> 0 for agent policy; API allows 0) |
| **Optional** | Client (helps filter projects; not sent to API) |
| **Auto-filled** | Staff fields on write |
| **Derived** | ProjectClient, ProjectName, ProjectCode, Task display name; Time Log ID on server; day total after merge; weekStart from date |
| **Must never guess** | `ProjectID`, `TaskID` |
| **May infer** | Date from “today/yesterday”; single exact name match after `list_*`; hours from “half day” only if user defined mapping in conversation (default: ask) |

**Not collectable (fields do not exist):** Description, billable, overtime, start/end time, attachments.

---

## INT-004 — Delete entry

| Class | Fields |
|-------|--------|
| **Required** | Date; which entry (Project+Task or unique line) |
| **Derived** | Remaining day set after delete |
| **Must never guess** | Which line if multiple similar |

---

## INT-005 — Clear day

| Class | Fields |
|-------|--------|
| **Required** | Date; explicit clear intent |
| **Derived** | Current entries (for confirmation display) |
| **Must never guess** | Date |

---

## INT-006–008 — Show timesheet

| Class | Fields |
|-------|--------|
| **Required** | Week or date reference |
| **Auto-filled** | Employee from session |
| **Derived** | weekStart = Monday of that week (`weekStartsOn: 1` in app) |
| **Optional** | Whether to resolve names via list_projects/tasks |

---

## INT-009 — Holidays

| Class | Fields |
|-------|--------|
| **Required** | None beyond auth |
| **Optional** | Year (default current); month filter client-side |
| **Auto-filled** | Location from profile/env on server |
| **Must never guess** | Location override (API has no location query) |

---

## INT-010 — Leave

| Class | Fields |
|-------|--------|
| **Required** | Period (month or range) |
| **Defaults** | Current month for monthly API if omitted |
| **Derived** | FULL/HALF, leaveType, status strings from Zoho |
| **Must never treat as fact without showing status** | “Approved only” — code does not filter |

---

## INT-011 / INT-012 — List projects / tasks

| Class | Fields |
|-------|--------|
| **Optional** | Filter text / client name |
| **Must never guess** | That filtered list is “assigned to me” — assignment not implemented |

---

## INT-013 — Custom project

| Class | Fields |
|-------|--------|
| **Required** | Exact new project name; TaskID; Date; Hours; explicit create consent |
| **Derived** | Client `*New`, Code `NEW-{name}`, new numeric ProjectID after create |
| **Must never guess** | That a typo should create a project |

---

## INT-024 — Copy previous day

| Class | Fields |
|-------|--------|
| **Required** | Target date; source date (default previous day) |
| **Derived** | Copied entry list |
| **Must never guess** | Overwrite if target non-empty without ask |

---

## INT-025 — Multi-day submit

| Class | Fields |
|-------|--------|
| **Required** | Full entry sets per day to persist |
| **Must never guess** | Skipping empty days deletes nothing on server (UI behavior) — if user wants clear, use INT-005 per day |

---

## Example card (Create Time Entry)

```text
Create Time Entry

Required
- Date
- Project (resolved to ProjectID, or confirmed new name)
- Task (resolved to TaskID)
- Hours

Optional
- Client (disambiguation only)

Default / Auto
- Current user (session)

Derived
- Project Client / Name / Code
- Task name
- weekStart
- Merged full-day entries payload

Must Never Guess
- Project ID
- Task ID
- Creating a new project from a failed match
```

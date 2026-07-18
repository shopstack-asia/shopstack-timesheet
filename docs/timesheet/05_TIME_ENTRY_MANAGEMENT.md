# 05 — Time Entry Management

**Confidence:** Confirmed by code

---

## How a time entry is created

1. User clicks **+ Add Entry** → client creates `{ id, projectId:'', taskId:'', hours:0 }`.
2. User fills Client (UI-only), Project, Task, Hours in `TimeEntryForm`.
3. Changes sync to parent state via `onUpdate`.
4. Persistence occurs only on **Submit Week** via per-day POST.

There is **no** separate “save draft” API.

---

## Field dictionary (UI + submit)

| Field | Type | Required | Default | Validation | Derived From | Code Evidence |
| ----- | ---- | -------: | ------- | ---------- | ------------ | ------------- |
| `id` (UI) | string | yes (UI) | `Date.now()` or Sheets Time Log ID | uniqueness soft | client or Sheets | `TimeEntry`, get route |
| Client | string | yes (UI only) | `''` | non-empty when touched | unique `ProjectClient` list | `TimeEntryForm` — **not sent to API** |
| `projectId` | string | yes | `''` | min 1 on server; UI non-empty | ProjectID **or** custom name text | submit Zod; TimeEntryForm |
| `taskId` | string | yes | `''` | must exist in Tasks sheet | Task.TaskID | submit taskMap check |
| `hours` | number | yes | `0` | UI `> 0`; server `0–24`; input min0 max24 step0.25 | user | Zod + input attrs |
| Date | string YYYY-MM-DD | yes (day) | day card date | regex on submit | week day | submit schema |
| Staff fields | strings | yes (server) | session profile | — | Zoho session | submit builds TimeLogRow |
| Project Client/Name/Code | strings | yes (server) | from Project row | — | Sheets project | submit mapping |
| Task name | string | yes (server) | from Task row | — | Sheets task | submit mapping |
| Time Log ID | string | yes (server) | SHA-256 prefix 16 | deterministic | date\|staff\|project\|task | `generateTimeLogId` |

### Fields not present

Billable, overtime, description, start/end time, location/work mode, attachments, tags, cost center, department (beyond staff Position denormalized), approval status on entry — **Not implemented**.

---

## Project selection logic

1. Load all projects; extract unique clients.
2. User must select a client first; projects filtered to that client.
3. If client is `*New` and user clicks **New**, free-text project name is stored in `projectId`.
4. On submit, unknown `projectId` → `createProject`.

**No** employee–project assignment filter. **Confirmed:** every signed-in user sees full Projects sheet.

---

## Task selection logic

All tasks from `Roles and Tasks` sheet are available for every entry regardless of project. **No** project–task linkage in code.

---

## Date handling

- Week starts **Monday** (`weekStartsOn: 1`).
- Day date is ISO `yyyy-MM-dd` from `date-fns` format.
- Submit accepts any matching date string; **no** past/future/weekend restriction on server.
- Sheets read normalizes various date formats via `normalizeDate`.

---

## Start/end time, duration, rounding

| Concern | Behavior |
|---------|----------|
| Start/end time | Not implemented — hours only |
| Duration | Numeric hours field |
| Rounding | UI step `0.25`; no forced rounding on server |
| Decimal precision | `parseFloat` / number; display `toFixed(2)` for totals |
| Minimum duration | UI requires `> 0` on submit; server allows `0` if sent |
| Maximum per entry | Server max **24**; UI input max 24 |
| Daily total limit | **Not enforced** (sum of entries can exceed 24) |
| Weekly limit | **Not enforced** |

---

## Description, billable, overtime, attachments, tags

**Not implemented.**

---

## Approval status on entry

**Not implemented.** Sheets row presence is the only persistence state.

---

## Entry ownership

Always session `EmployeeID`. Cannot set another staff id via API.

---

## Duplicate detection

| Layer | Behavior |
|-------|----------|
| Get API | Skips duplicate Time Log IDs in response (`seenIds`) |
| Submit / Sheets | Upsert key = Date + Staff + Project + Task (hash ID); same key updates hours |
| Same day two entries same project+task | Second overwrites first on submit (same Time Log ID) |
| UI | Allows multiple rows with same project/task before submit — last write wins server-side |

---

## Overlap detection

**Not implemented** (no time ranges).

---

## Copy / clone

`handleCopyYesterday` clones previous day entries with new UI ids and **appends** (only when target day empty).

---

## Bulk operations

| Operation | Behavior |
|-----------|----------|
| Bulk create | Multiple entries per day; week submit posts days sequentially |
| Bulk update | Re-submit day replaces by Project\|Task set |
| Bulk delete | Omit entries from day’s submit → deleted from Sheets; **UI does not submit empty days**, so clearing a previously submitted day in UI and submitting week **will not delete** those Sheets rows (gap) |

**Confidence:** Gap inferred from `submitWeekDaysSequentially` filtering `entries.length > 0` and DailyCard/UI behavior — Confirmed by code.

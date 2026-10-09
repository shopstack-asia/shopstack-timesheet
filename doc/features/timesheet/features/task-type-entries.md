# Task type entries

### Overview

Each timesheet row starts with a **Task type**. The type chooses which dropdowns are shown and how the row is written to the Google Sheets Time Log.

### Business Purpose

Separate client delivery, sales work, Shopstack internal development, and internal operations without overloading the Project Delivery client list.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff | `/timesheet`, `POST /api/timesheet/submit` | Pick a task type, fill the fields for that type, submit the week |

Slack confirm/write still sends `projectId` + `taskId` with no `taskType`. That path stays Project Delivery.

### Workflow

1. User adds a row. Task type defaults to **Project Delivery**.
2. The form shows only the fields for the selected type.
3. Submit Week sends `taskType` plus the fields that type needs.
4. `submitDayTimesheetForStaff` resolves master data, then writes Time Log columns for that type.
5. Reload infers the type from the Time Log row so the form opens in the same mode.

### Screen Behavior

| Task type | Fields |
|-----------|--------|
| Project Delivery | Client, Project, Task, Hours. The client list omits Shopstack, `*New`, and `*Other`. |
| Sales & Presales | Client, Project, Hours. Each dropdown has **+**. No task dropdown. |
| Internal Development | Project, Task, Hours. No client dropdown. Projects are those whose Project Client is Shopstack. |
| Internal Operations | Task, Hours. Tasks come from the Dropdown sheet. |

**Sales & Presales +**

- **+** on Client asks for a client name and adds it to the dropdown for this session. It is stored on the Sales Projects sheet only when a project is saved under it.
- **+** on Project replaces the project dropdown with project name and project code, then `POST /api/master/sales-projects`. **×** returns to the dropdown. The code must be unique across Sales Projects (trim, case-insensitive). A duplicate returns 409 and is shown on the form.

### Business Logic

Time Log columns by type:

| Task type | Project ID | Project Client | Project Name | Project Code | Task ID | Task |
|-----------|------------|----------------|--------------|--------------|---------|------|
| Project Delivery | Master project id (or new `*New` id) | From the project | From the project | From the project | Master task id | Master task name |
| Sales & Presales | `0` | From the Sales Projects row | From the Sales Projects row | From the Sales Projects row | `0` | `Sales & Presales` |
| Internal Development | Master project id | Shopstack (from the project row) | From the project | From the project | Master task id | Master task name |
| Internal Operations | `0` | `Shopstack` | `Internal Operations` | `INTERNAL_OPERATIONS` | `0` | Selected operation task name |

Sales names and codes written to the Time Log come from the Sales Projects sheet, not from free text on the submit body. Operation task spelling comes from the Dropdown sheet (case-insensitive match, sheet spelling is kept).

**Row identity.** Project Delivery and Internal Development still sync on `Project ID|Task ID`. Sales and Internal Operations both store Project ID `0` and Task ID `0`, so the sync key and Time Log ID also include Project Code and Task. Two sales projects on the same day stay two rows. An operation task does not overwrite a sales row. Real project/task ids keep the previous Time Log ID hash (`date|staffId|projectId|taskId`).

**Reload classification**

- Project ID `0`, Task ID `0`, Task `Sales & Presales` → Sales & Presales
- Project ID `0`, Task ID `0`, Project Code `INTERNAL_OPERATIONS` → Internal Operations
- Any other row whose Project Client is Shopstack and Project ID is not `0` → Internal Development
- Otherwise → Project Delivery

### Validation Rules

| Layer | Rules |
|-------|--------|
| Client | Hours > 0. Delivery and internal development need project and task. Sales needs client and project code. Operations needs a task name. |
| API | `taskType` optional enum. Hours 0–24. Unknown sales code, unknown operation task, or a non-Shopstack internal-development project → 400 (`Invalid …`). Duplicate sales project code on create → 409. |
| Sales code | Unique on the whole Sales Projects sheet, compared trim + case-insensitive. |

Custom `*New` projects are created only for Project Delivery. Internal Development never creates a project.

### Edge Cases

- Adding a sales client without saving a project does not write a sheet row.
- Shopstack projects are edited as Internal Development after reload, including rows that were submitted before task types existed.
- Empty Sales Projects or a missing Operation Task column leaves that dropdown empty; submit of those types then fails validation.
- Slack writes without `taskType` are unchanged.

### API and Integration Behavior

- `GET /api/master/sales-projects` → `{ projects, clients }`
- `POST /api/master/sales-projects` body `{ projectClient, projectName, projectCode }`
- `GET /api/master/operation-tasks` → `string[]`
- `POST /api/timesheet/submit` entries may include `taskType`, `projectClient`, `projectName`, `projectCode`, `taskName`

Sheet tabs (same spreadsheet):

- `Sales Projects` columns A–C: Project Client, Project Name, Project Code (row 1 header, data from row 2)
- `Dropdown` row 1 contains a column header `Operation Task`; names are the cells under that header

### Known Limitations

- A client name added with **+** disappears on refresh if no project was saved under it.
- Two creates of the same new project code at the same moment can both pass the read-then-append check.
- Existing duplicate codes already on Sales Projects are not cleaned up; new duplicates are rejected.

### Source Code References

- `src/components/TimeEntryForm.tsx`
- `src/components/WeeklyTimesheet.tsx`
- `src/lib/timesheet/task-type.ts`
- `src/lib/timesheet/timesheet-service.ts`
- `src/lib/google-sheets.ts`
- `src/app/api/master/sales-projects/route.ts`
- `src/app/api/master/operation-tasks/route.ts`
- `src/app/api/timesheet/submit/route.ts`

### Required tests

- `src/lib/timesheet/task-type.test.ts` — identity hash, classification, field builders, duplicate code, Dropdown column, readiness
- `src/lib/timesheet/task-type-submit.test.ts` — sales rows stay separate, operations and Shopstack development writes, rejected code, rejected non-Shopstack project

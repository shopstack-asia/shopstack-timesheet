# Custom project on submit

### Overview

When an entry’s `projectId` is not a known Project ID, the server treats it as a new project name, creates a Projects sheet row, then writes the Time Log against the new ID.

### Business Purpose

Allow logging time to ad-hoc work without pre-creating every project in Sheets.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff | Via timesheet submit | Create `*New` project rows |

### Workflow

1. UI: user picks client `*New` / “New” and enters a free-text name into `projectId` (`TimeEntryForm`).
2. Submit finds `projectId` missing from `projectMap`.
3. `createProject(name)`:
   - Next numeric Project ID
   - `ProjectClient: '*New'`
   - `ProjectName: name`
   - `ProjectCode: NEW-${name}`
   - Append to `Projects!A:D`; clear in-process Sheets cache
4. Time Log written with the generated Project ID and metadata.

### Business Logic

- One create per distinct custom name in a submit batch (`projectIdMap`).
- Tasks still must exist in master tasks (custom tasks not supported).

### Validation Rules

- Custom name must be non-empty string (Zod `projectId.min(1)`).
- Task ID still validated against master list.

### Edge Cases

- Duplicate custom names in same batch reuse the first created ID.
- Project code embeds raw name (`NEW-${projectName}`) — special characters possible.

### API and Integration Behavior

- Triggered inside `POST /api/timesheet/submit` only (no dedicated create-project API).

### Data Model Summary

- New `Project` row shape as above; Time Log uses resolved Project ID.

### Source Code References

- `src/components/TimeEntryForm.tsx`
- `src/app/api/timesheet/submit/route.ts`
- `src/lib/google-sheets.ts` (`createProject`, `getNextProjectId`)

### Required tests

- Unknown projectId creates `*New` project then log row
- Known projectId does not create
- Batch dedupes same custom name

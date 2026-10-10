# Shared work context

### Overview

`WorkContextRef` is an optional pointer to the kind of work a future module may attach to a record. It mirrors the four timesheet task types without writing the Time Log.

### Business Purpose

Expense and later modules need a place to store a project or internal context. Those contexts do not all have a ProjectID.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Server code | Mapper only | Convert an in-memory timesheet-shaped object |

No new API is exposed.

### Workflow

1. A caller passes task type plus the ids and labels it already has.
2. `toWorkContextRef` returns a compact reference.
3. Timesheet submit continues to use its own payload builders.

### Use Cases

- Project delivery and internal development keep a non-zero ProjectID.
- Sales & Presales keeps ProjectCode and omits ProjectID.
- Internal Operations keeps `INTERNAL_OPERATIONS` and omits ProjectID.

### Screen Behavior

No screen.

### Business Logic

| Kind | Identity |
|------|----------|
| `project_delivery` | ProjectID and TaskID when they are not blank or `0` |
| `internal_development` | Same as delivery. Shopstack client projects still have a ProjectID on the Time Log. |
| `sales_presales` | ProjectCode. ProjectID `0` is omitted. |
| `internal_operations` | Project code `INTERNAL_OPERATIONS`. ProjectID `0` is omitted. |
| `unspecified` | Reserved. The mapper does not emit it. |

A missing task type is treated as `project_delivery`, matching the timesheet default.

### Validation Rules

The mapper does not validate hours or submit policy.

### Edge Cases

Zero master ids are placeholders. They are not foreign keys.

### API and Integration Behavior

Existing `/api/master/*` responses are unchanged. This helper does not call Google Sheets.

### Data Model Summary

`WorkContextRef` fields are all optional except `kind`: `projectId`, `projectCode`, `projectName`, `projectClient`, `taskId`, `taskName`.

### Status Lifecycle

Not applicable.

### Operation Notes

Do not add a ProjectID column requirement to future expense tables.

### Known Limitations

The mapper is not used by the timesheet save path. It does not load Projects or Sales Projects.

### Source Code References

- `src/types/shared/work-context.ts`
- `src/lib/master/work-context.ts`
- `src/lib/timesheet/task-type.ts`

### Required tests

- Delivery and internal development keep ProjectID
- Sales and internal operations omit ProjectID
- Internal operations defaults the project code to `INTERNAL_OPERATIONS`
- A zero id with no task type does not invent a ProjectID

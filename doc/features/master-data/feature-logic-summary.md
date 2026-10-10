# Master data — feature logic summary

| Doc | Description |
|-----|-------------|
| [projects-and-tasks-from-sheets.md](./features/projects-and-tasks-from-sheets.md) | Master BFF contracts, sheet columns (Projects, tasks, Sales Projects, Dropdown / Operation Task), 5-min cache |
| [shared-work-context.md](./features/shared-work-context.md) | Optional work-context reference for future modules. Does not change Sheets writes. |

## Related code

- `src/app/api/master/projects/route.ts`
- `src/app/api/master/tasks/route.ts`
- `src/app/api/master/sales-projects/route.ts`
- `src/app/api/master/operation-tasks/route.ts`
- `src/lib/google-sheets.ts`

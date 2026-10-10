# Master data — domain features

## Capabilities

1. **Projects list** — Sheets `Projects!A2:D` → `Project` objects + sorted unique `clients`.
2. **Tasks list** — Roles and Tasks sheet → `Task` objects.
3. **Sales Projects** — `Sales Projects!A2:C` (client, name, code) plus create with a unique project code.
4. **Operation tasks** — `Dropdown` sheet column `Operation Task`.
5. **In-process cache** — 5 minute TTL for projects, tasks, sales projects, and operation tasks (not Redis). Cleared when a custom project or sales project is created.
6. **Shared work context** — optional reference for future modules. It does not change these Sheets APIs. ProjectID is not required for every context.

## Dependencies

- Google service account + spreadsheet ID
- Auth session (middleware + handler)

## Non-obvious constraints

- Custom project creation is owned by **timesheet** submit (`*New`), which clears this cache.
- `src/lib/cache.ts` exists but is **unused** by these paths.

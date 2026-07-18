# Master data — domain features

## Capabilities

1. **Projects list** — Sheets `Projects!A2:D` → `Project` objects + sorted unique `clients`.
2. **Tasks list** — Roles and Tasks sheet → `Task` objects.
3. **In-process cache** — 5 minute TTL for projects/tasks (not Redis). Cleared when a custom project is created.

## Dependencies

- Google service account + spreadsheet ID
- Auth session (middleware + handler)

## Non-obvious constraints

- Custom project creation is owned by **timesheet** submit (`*New`), which clears this cache.
- `src/lib/cache.ts` exists but is **unused** by these paths.

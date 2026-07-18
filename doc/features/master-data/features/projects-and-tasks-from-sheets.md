# Projects and tasks from Google Sheets

### Overview

Authenticated clients load project/task master data for selectors. Data comes from Google Sheets with a 5-minute process-memory cache.

### Business Purpose

Drive timesheet dropdowns without exposing Sheets credentials to the browser.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Authenticated staff | `/api/master/projects`, `/api/master/tasks` | Read |
| Unauthenticated | Denied (middleware + 401) | — |

### Workflow

1. UI fetches both endpoints on week load.
2. Handlers call `getCachedProjects()` / `getCachedTasks()`.
3. Projects response also returns unique sorted client names for cascading filters.

### Use Cases

- Populate client → project → task selectors
- After custom project create, next cache miss/refresh includes new row

### Business Logic

- Projects range: `Projects!A2:D` → ProjectID, ProjectClient, ProjectName, ProjectCode.
- Tasks: Roles and Tasks sheet (see `getTasks` in google-sheets).
- Cache TTL: `5 * 60 * 1000` ms in module scope.

### Validation Rules

- Session required; projects handler checks `getServerSession`.

### API and Integration Behavior

**`GET /api/master/projects`**

```json
{ "success": true, "data": { "projects": [Project], "clients": ["…"] } }
```

**`GET /api/master/tasks`**

```json
{ "success": true, "data": [Task] }
```

- Upstream: Google Sheets API (server-only).

### Data Model Summary

- `Project`, `Task` in `src/types/index.ts`.

### Operation Notes

#### Sheet tabs and columns (case-sensitive names)

**Projects** (`Projects!A2:D`):

| Col | Field |
|-----|--------|
| A | ProjectID |
| B | ProjectClient |
| C | ProjectName |
| D | ProjectCode |

**Roles and Tasks**:

| Col | Field |
|-----|--------|
| A | TaskID |
| B | Task |

**Time Log** (written by timesheet submit — see timesheet feature):

Time Log ID, Date, Staff ID, Staff First Name, Staff Last Name, Staff Position, Project ID, Project Client, Project Name, Project Code, Task ID, Task, Hours.

#### Service account setup

1. Enable Google Sheets API; create service account; download JSON key.
2. Set `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (quoted, keep `\n`).
3. **Share the spreadsheet** with the service account email as **Editor** (or Viewer if read-only — write needs Editor).
4. Restart the server after sharing.

#### Troubleshooting

| Symptom | Fix |
|---------|-----|
| “This operation is not supported for this document” / permission errors | Share sheet with SA email; confirm spreadsheet ID |
| Empty projects/tasks | Sheet/tab names or columns mismatch |
| Private key parse errors | Ensure quoted key with `\n` newlines |

Env catalog: [ops/environment-variables.md](../../ops/features/environment-variables.md).

### Known Limitations

- Cache is per Node process (not shared across serverless instances); Redis not used here.
- Stale up to 5 minutes unless `clearSheetsCache()` after create.

### Source Code References

- `src/app/api/master/projects/route.ts`
- `src/app/api/master/tasks/route.ts`
- `src/lib/google-sheets.ts` (getProjects/getTasks/cache helpers)
- `.env.example`

### Required tests

- 401 without session
- Clients unique + sorted
- Cache hit within TTL skips Sheets (mocked)

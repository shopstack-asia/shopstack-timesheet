# Expense Drive and persistence plan

### Overview

Timesheet data stays in Google Sheets. Expense transactions use PostgreSQL. Expense files will use a company Shared Drive later. Drive is not connected, so attachment bytes are stored in PostgreSQL. Postgres is contacted when `EXPENSE_DATABASE_URL` is set: startup applies SQL migrations, and expense API routes read and write the ledger.

### Business Purpose

Keep expense writes off the Time Log spreadsheet and off the browser.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Server | Future Drive and database credentials | Not available to the browser |
| Employee | None of the future stores yet | No upload |

### Workflow

When both Drive ids are set, saving an expense creates this layout. The item folder name is the expense request number, issued before a claim exists:

```text
ShopStack Workspace/
└── Expenses/
    └── YYYY/
        └── EXP-YYYY-NNNNNN/
            ├── receipt.pdf
            └── supporting-document.jpg
```

### Use Cases

- Save an expense. The server creates `Expenses/YYYY/EXP-YYYY-NNNNNN/` when Drive is configured.
- Add a PDF, JPG, or PNG. The file is uploaded into that folder.

### Screen Behavior

The expense form's existing attachment control is the upload. The expense list and detail show the request number. There is no separate Drive button.

### Business Logic

Persistence constants:

| Module | Store |
|--------|-------|
| Timesheet | `google-sheets` |
| Expense | `dedicated-transactional-database` (PostgreSQL) |

There is no ORM. Migration `001_expense_ledger` creates `expense_categories`, `expense_claims`, `expense_entries`, and `expense_attachments`.

When `EXPENSE_DATABASE_URL` is unset, startup does not open a database connection. When it is set, `src/instrumentation.ts` calls `migrateExpenseDatabaseOnStartup` on the Node server (not the edge runtime):

1. Connect with the `pg` client.
2. Take a session advisory lock.
3. Create `expense_schema_migrations` if it is missing (`id`, `applied_at`).
4. Apply each entry in `EXPENSE_MIGRATIONS` that is not already recorded, in order, one transaction per migration.
5. Close the connection.

A failed migration is rolled back and the process fails to start. Earlier migrations in that run stay committed. The URL is not logged.

`EXPENSE_MIGRATIONS` starts with `001_expense_ledger`. The migration ledger table is still created so each id is recorded once.

Drive adapter location when implemented: `src/lib/expense/drive/`, server-only.

Scope used by the expense Drive client: `https://www.googleapis.com/auth/drive`.

Do not add that scope to `src/lib/google-sheets.ts`, which stays on `https://www.googleapis.com/auth/spreadsheets`. `drive.file` can create a Shared Drive file and then fail to find that same file on delete.

Shared Drive setup for a later phase:

- Use a company-owned Shared Drive, not a personal My Drive.
- Add the existing service account as a member of that Shared Drive.
- Grant access on the Expenses folder rather than the entire Drive when the Drive admin tools allow it.
- Put the Shared Drive id in `GOOGLE_DRIVE_SHARED_DRIVE_ID`.
- Put the existing Expenses folder id in `GOOGLE_DRIVE_EXPENSES_ROOT_FOLDER_ID`.
- Keep using `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` on the server. Do not create a second credential and do not expose either value to the client.

`readExpenseDriveConfig` reports `implemented: true` only when both folder ids are set. Saving an expense then creates the year folder and the `EXP-YYYY-NNNNNN` folder. Each new attachment is uploaded into that folder and is still stored in PostgreSQL for download and print. Deleting the expense removes that request folder. The year folder stays. The Drive client lives in `src/lib/expense/drive/folders.ts` and does not change the Sheets scope.

### Validation Rules

Empty Drive env values are ignored. They do not enable upload.

### Edge Cases

One folder id without the other does not upload. A Drive error fails the save and rolls back the database write. Deleting an attachment removes the stored Drive file and any file of the same name in that expense folder, and leaves the request folder in place. Deleting the expense removes `Expenses/YYYY/EXP-YYYY-NNNNNN/` after its files. A missing folder is already gone. The year folder is not removed. On this Shared Drive, permanent delete answers `File not found` for a Content manager while the file is still in the folder. That answer is not treated as success by itself: the same item is moved to trash, which removes it from the folder. Trash is also used when Drive refuses with a permissions error. Other Drive delete errors stop the delete.

### API and Integration Behavior

`src/lib/expense/drive/folders.ts` calls the Drive API with `https://www.googleapis.com/auth/drive` on its own auth client. `src/lib/google-sheets.ts` is not used for this upload.

### Data Model Summary

Expense rows are `expense_entries` and include `request_number`. Claims are `expense_claims`. Categories are `expense_categories`, seeded from the claim-form code list. Attachment bytes are `expense_attachments.content`, and `drive_file_id` points at the uploaded file when Drive is configured. `expense_meta` stores the last issued request sequence. `expense_schema_migrations` records applied ids. Optional future project reference uses `WorkContextRef`, where `projectId` may be absent.

### Status Lifecycle

Not applicable.

### Operation Notes

Do not change production Google credentials or Vercel environment variables for this foundation.

### Known Limitations

The service account must be a Content manager of the Shared Drive. PDF generation runs in the browser from rows loaded through the API. Add later schema changes as new ids in `EXPENSE_MIGRATIONS`; they run on the next server start.

### Source Code References

- `src/lib/expense/db/store.ts`
- `src/app/api/expense/`
- `src/lib/expense/persistence.ts`
- `src/lib/expense/db/migrate-on-startup.ts`
- `src/lib/expense/db/migrations.ts`
- `src/instrumentation.ts`
- `src/lib/expense/drive/config.ts`
- `src/lib/expense/drive/folders.ts`
- `src/lib/google-sheets.ts`
- `src/lib/master/work-context.ts`
- `.env.example`

### Required tests

- Expense persistence value is `dedicated-transactional-database`
- Unset `EXPENSE_DATABASE_URL` does not connect
- Pending migrations apply in order and are not applied twice
- A failed migration rolls back and does not record its id
- Startup calls `migrateExpenseDatabaseOnStartup`
- Drive config scope is `https://www.googleapis.com/auth/drive`. `implemented` is false until both folder ids are set, then true
- Deleting an expense targets the request folder name `EXP-YYYY-NNNNNN`, not the year folder
- A Drive 404 or permissions 403 from permanent delete still moves that item to trash. Trash that also returns 404 means the item is already gone
- Sheets source keeps the spreadsheets scope and does not mention `auth/drive`

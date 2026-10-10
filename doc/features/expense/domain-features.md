# Expense — domain features

## Capabilities

1. **Landing** — `/expense` redirects to `/expense/mine`.
2. **Employee expenses** — the signed-in Zoho profile creates, edits, submits, cancels, and deletes their own draft expenses. An Administrator can delete any expense and any claim.
3. **Management screens** — All Expenses, Monthly Summary, Expense Claims, and Manage Category read and write the same PostgreSQL ledger. The pages open for HR or ADMIN only. Opening them does not assign a role.
4. **API gate** — `GET /api/expense/management` denies access unless the workspace role is HR or ADMIN. It still returns no expense rows.
5. **Lifecycle** — Expenses: DRAFT, SUBMITTED, PAID, CANCELLED. SUBMITTED is not approval. A claimed item keeps its status and shows the claim number. Claims: PROCESSING, then PAID once every included expense is PAID.
6. **PostgreSQL persistence** — entries, categories, claims, and attachment bytes stay in the expense database. Timesheet stays on Google Sheets.
7. **Startup migrations** — the Node server applies pending expense SQL migrations before serving traffic when `EXPENSE_DATABASE_URL` is set. An unset URL skips the connection. A migration failure stops startup. Expense screens then report that the database is not configured.
8. **Drive folders** — when both Drive folder ids are set, the server creates `Expenses/YYYY/EXP-YYYY-NNNNNN/` for each expense and uploads attachments there. Deleting the expense removes that request folder. The year folder stays. The Sheets client is unchanged.

## Dependencies

- Workspace session and `authorizeExpenseManagement`
- `EXPENSE_DATABASE_URL` (PostgreSQL). No ORM. Unset: expense screens cannot load.
- Shared Drive is not connected.

## Non-obvious constraints

- Expense code under `src/lib/expense` must not import Google Sheets.
- A work context on a future expense may omit ProjectID. Sales uses ProjectCode. Internal Operations uses `INTERNAL_OPERATIONS`.
- Do not treat a zero master id as a foreign key.

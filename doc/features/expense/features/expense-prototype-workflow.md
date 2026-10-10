# Expense prototype workflow

### Overview

Signed-in employees record expenses, attach files, and submit them. Management pages consolidate submitted expenses into a monthly claim and generate a printable PDF package. Rows, categories, claims, and attachment bytes are stored in PostgreSQL.

### Business Purpose

Keep expense records in the expense database instead of the browser or the Time Log spreadsheet.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Signed-in employee | My Expenses and My Monthly Claims | Create and change only their own drafts |
| HR / ADMIN | Expense Management screens | Read the ledger, generate claims, mark claims paid, and save categories. `GET /api/expense/management` still returns no expense rows |

The requester is the Zoho People profile on the session. Employee id and code are `EmployeeID`. The name is first and last name. Business unit is `Position`. These screens do not change the session role.

### Workflow

1. Sign in. Open Expense → My Expenses. The list starts empty until this user saves an expense.
2. Add an expense, attach PDF or images, and save a draft. The server stores it for the signed-in employee and assigns `EXP-YYYY-NNNNNN`. That number is the Drive folder name.
3. Submit the draft from My Expenses.
4. Open Expense Management → Monthly Summary. View expenses shows the claim form for that employee's submitted, unclaimed rows and does not issue a claim number. Generate monthly claim creates the numbered document.
5. Open the claim. Download or print includes the claim form and every attachment.
6. Timesheet storage is not changed.

### Use Cases

- Draft, submit, cancel, and delete a personal expense.
- Consolidate one month without including drafts, cancelled rows, or rows already on a claim.
- Produce one PDF that starts with the claim form and then each supporting file.

### Screen Behavior

- My Expenses and My Monthly Claims are the employee menu. Add expense is a button on the right of the My Expenses heading. `/expense/new` stays available from that button.
- All Expenses uses the same list as My Expenses. It has no Add expense button and no Mark paid action. Draft rows are omitted, and Draft is not in the status filter. It lists every stored expense and shows that requester's code and name on each row. The detail page shows Requester with the same code and name.
- Monthly Summary → View expenses opens the same claim form layout. It lists that employee's submitted expenses for the selected month that are not on a claim yet. No claim number is shown or stored. Generate on that page, or Generate monthly claim on the summary, creates the numbered document.
- Manage Category is an inline table. Each row edits its name in place. A new row also edits its code. Delete removes that row from the table only. Add appends a blank row at the bottom. Save, at the top, writes every rename, addition, and deletion in one replacement. A blank row is ignored. A code used by an expense cannot be deleted, and nothing is written when the batch is invalid. New codes appear on the expense form after Save.
- The expense list filters by month, status, category, and description. Status and category accept more than one value, shown as tags. An empty selection means all. Month and expense date use a calendar popup. The stored values stay `YYYY-MM` and `YYYY-MM-DD`. A draft card keeps the default surface. Submitted cards are light blue, paid cards are light green, and cancelled cards are light yellow. The status badge fill matches the card surface. Its border and text stay in that same tone, darker than the card. Draft and processing badges stay gray on the default surface.
- Claim lists filter by month and status. Status accepts more than one value, shown as tags. An empty selection means all. A processing claim card keeps the default surface. A paid claim card is light green, the same surface as a paid expense. Download and Print, on My Monthly Claims and on the claim page, always include the claim form and every attachment. Each attachment page repeats the claim header: logo, claim number, title, name, business unit, purpose, and date. The claim page shows the Expense Claim Form layout, including every expense on the claim. There is no seeded sample claim.
- Empty filters say that nothing matches.
- PDF buttons show the error text when a file cannot be merged. They do not download a partial package.
- Save, submit, cancel, delete, mark paid, generate, download, and print disable the pressed control and show a loading label until that request finishes. A second click does not send the action again. A failed request enables the control again. A save, generate, or delete that leaves the page stays loading until the next page opens.

### Business Logic

Statuses are DRAFT, SUBMITTED, PAID, and CANCELLED. SUBMITTED is not approval. A submitted row with a claim id cannot be claimed again. The list and detail show that claim's document number, such as `EXP-2026-09-0001`, beside the status. THB uses exchange rate 1. Other currencies require a rate. Amount (THB) is amount × rate, half-up to two decimal places. Categories are seeded from `EXPENSE_CATEGORIES` by migration `001_expense_ledger` and then come from `expense_categories`.

### Validation Rules

Date, category, explanation, currency, and a positive amount are required. Attachments must be PDF, JPG, or PNG, at most 8 MB each, and at most 8 per expense. A category code is 3 to 6 digits and needs a name. Duplicate codes are rejected. Category Save replaces the whole list, and a failed batch leaves the stored list unchanged.

### Edge Cases

- `EXPENSE_DATABASE_URL` unset or the database unreachable: the screen shows that error and does not fall back to browser storage.
- Missing attachment blob: PDF generation throws and names the file.
- Unsupported or corrupt PDF: generation throws and names the file.
- No eligible rows: claim generation explains that nothing is available.

### API and Integration Behavior

The screens call same-origin `/api/expense/*` routes. Those routes require a session and use PostgreSQL. They do not call Google Sheets or Google Drive. `GET /api/expense/management` remains the HR authorization probe and does not return rows. An employee can change only their own draft. Any signed-in employee can read the ledger, generate a claim, mark a claim paid, and save categories until an HR role source exists.

### Data Model Summary

`expense_entries`, `expense_claims`, `expense_categories`, and `expense_attachments` live in PostgreSQL. Each expense receives `request_number` `EXP-YYYY-NNNNNN` at creation. Claim numbers stay `EXP-YYYY-MM-NNNN`. Attachment content is `bytea`. When both Drive folder ids are set, the server also creates `Expenses/YYYY/EXP-YYYY-NNNNNN/` and uploads each file there. Deleting the expense removes that request folder. The year folder stays. Record ids are UUIDs. The requester code stored on each row is the Zoho `EmployeeID`.

### Status Lifecycle

DRAFT can be edited, deleted, submitted, or cancelled. An Administrator can delete an expense in any status, including one that belongs to someone else or sits on a claim. SUBMITTED, PAID, and CANCELLED open the same expense form as a draft, with every field locked and without Save draft. SUBMITTED can be cancelled until it is placed on a claim. PAID and CANCELLED are excluded from new claims. A paid expense keeps its claim number until the claim is deleted. The screen shows the claim number next to the expense status. A new claim is PROCESSING. Expense Claims can mark a processing claim paid from the list or the claim page, after confirmation, which marks every submitted expense on it paid. The claim becomes PAID when every expense on it is PAID. An Administrator can delete a claim in either status from the list or the claim page, after confirmation. The expenses remain, with the claim link removed and their status unchanged. Claim lists and the claim page show that status. Each claim row has a checkbox. Selected claims can be downloaded or printed together, and processing claims can be marked paid together.

### Operation Notes

Set `EXPENSE_DATABASE_URL`, start the app with `npm run dev`, and let startup apply `001_expense_ledger`. Sign in and open `/expense/mine`. Restart the server after adding the database URL so the migration runs.

### Known Limitations

The claim PDF follows the supplied Expense Claim Form: Shopstack logo, name, business unit, purpose, date, the blue expense table, total expenses, total claimed / (returned), the receipt note, three blank signature lines, and the category code box. It is drawn to that structure; it is not a filled copy of the original spreadsheet. The claim number is printed in the header because the paper form has no claim-number field. Signature lines stay blank. Total claimed uses the same total as total expenses because cash advances are not modeled. Helvetica cannot draw Thai characters, so unsupported characters are replaced. There is no approval workflow.

### Source Code References

- `src/lib/expense/db/store.ts`
- `src/app/api/expense/`
- `src/lib/expense/employee.ts`
- `src/lib/expense/prototype/`
- `src/lib/expense/pdf/claim-form.ts`
- `src/lib/expense/pdf/package.ts`
- `src/components/expense/prototype/`
- `src/app/(workspace)/expense/`

### Required tests

- An Administrator can delete an expense in any status, and can delete a claim while leaving its expenses in place
- Currency conversion and file-type rejection
- Monthly totals, exclusion of drafts and cancelled rows, and duplicate claim prevention
- Claim PDF contains the title, employee, and total, and continues onto another page
- Full package keeps every page of a multi-page PDF and rejects an unreadable attachment by name
- Category Save writes renames, additions, and deletions together, and leaves storage unchanged when a used category is removed or a code is duplicated
- A caller-supplied employee is stored on the expense instead of a demo employee
- Request numbers are `EXP-YYYY-NNNNNN`, increase within the year, and stay unused after the expense is deleted
- Each expense action has one loading label: Saving, Submitting, Cancelling, Deleting, Marking paid, Generating, Downloading, or Printing
- Migration `001_expense_ledger` creates the expense tables and seeds category `453`

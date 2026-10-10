# Expense — feature area

## Purpose

Expense screens inside ShopStack Workspace. Entries, categories, claims, and attachment bytes are stored in PostgreSQL when `EXPENSE_DATABASE_URL` is set. Google Drive is not used. Timesheet stays on Google Sheets.

## Scope

- Employee routes `/expense/mine`, `/expense/new`, `/expense/claims`
- Management routes `/expense/management/expenses`, `/expense/management/summary`, `/expense/management/claims`, `/expense/management/categories`
- PostgreSQL entries, categories, claims, and attachment bytes
- Claim-form PDF and a merged package of supporting documents
- Status names DRAFT, SUBMITTED, PAID, CANCELLED
- Server gate on `GET /api/expense/management` (deny unless HR or ADMIN)
- Startup SQL migrations when `EXPENSE_DATABASE_URL` is set
- Google Drive plan only

## Out of scope

- Approval, payment, and reimbursement
- ORM and Prisma
- Drive upload and folder creation
- Granting HR or Admin from a job title. Those roles are assigned under Settings → Roles & Permission.

## Reading order

1. This README
2. [domain-features.md](./domain-features.md)
3. [feature-logic-summary.md](./feature-logic-summary.md)
4. [features/](./features/)
5. Code

## Related areas

- `workspace` — navigation and authorization
- `master-data` — optional work-context reference
- `timesheet` — separate persistence (Google Sheets)

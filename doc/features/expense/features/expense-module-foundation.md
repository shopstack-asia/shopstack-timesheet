# Expense module foundation

### Overview

This note records the original route reservation. The interactive behavior is in [expense-prototype-workflow.md](./expense-prototype-workflow.md). `/expense/requests` and `/expense/requests/new` redirect to the prototype. The management pages are a local HR demo. `GET /api/expense/management` still denies current sessions.

### Business Purpose

Reserve routes and module folders so later expense work does not start inside the timesheet code.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Signed-in employee | Expense menu, including the HR demo labels | Uses fictional demo data only |
| Current session | `GET /api/expense/management` | Denied until a real HR or ADMIN role exists |

### Workflow

1. `/expense` redirects to `/expense/mine`.
2. Older request URLs redirect to the prototype pages.
3. `/expense/management` redirects to the monthly summary demo.
4. The API route still calls `authorizeExpenseManagement`.

### Use Cases

- Confirm older expense URLs still resolve.
- Confirm the API does not return production expense rows.

### Screen Behavior

Screen behavior is the prototype workflow. There is no placeholder table.

### Business Logic

Statuses used by the prototype are DRAFT, SUBMITTED, PAID, and CANCELLED. SUBMITTED does not mean approved.

### Validation Rules

Validation lives in the prototype service. The API route accepts no expense payload.

### Edge Cases

Opening a management page does not grant HR. The demo employee list is hardcoded and is not the Zoho staff directory.

### API and Integration Behavior

`GET /api/expense/management` returns 401 or 403 for current users. It does not return expense rows.

No Zoho, Sheets, Slack, or Drive call is made from these pages.

### Data Model Summary

Prototype records are documented in the workflow note. `ExpenseRequestStatus` remains the shared status union.

### Status Lifecycle

See the prototype workflow. Approval transitions do not exist.

### Operation Notes

`EXPENSE_DATABASE_URL` is required for the expense screens. When it is unset, startup skips the connection and the screens show the configuration error. Optional Drive names are commented in `.env.example`.

### Known Limitations

Approval, payment, and reimbursement are unimplemented. The local prototype is documented separately and is not a production ledger.

### Source Code References

- `src/app/(workspace)/expense/page.tsx`
- `src/app/(workspace)/expense/requests/page.tsx`
- `src/app/(workspace)/expense/requests/new/page.tsx`
- `src/app/(workspace)/expense/management/page.tsx`
- `src/components/expense/ExpensePlaceholder.tsx`
- `src/types/expense/request-status.ts`

### Required tests

- Older request routes redirect into the prototype
- The management API still calls `authorizeExpenseManagement`
- Status list is exactly DRAFT, SUBMITTED, PAID, CANCELLED
- Expense library sources do not reference `google-sheets` or `googleapis`

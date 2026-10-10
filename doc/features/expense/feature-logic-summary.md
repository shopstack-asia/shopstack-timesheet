# Expense — feature logic summary

| Doc | Description |
|-----|-------------|
| [expense-prototype-workflow.md](./features/expense-prototype-workflow.md) | Local expense entry, monthly claims, and printable PDF package |
| [expense-module-foundation.md](./features/expense-module-foundation.md) | Original foundation notes. The prototype doc is the current behavior. |
| [expense-drive-and-persistence-plan.md](./features/expense-drive-and-persistence-plan.md) | Drive plan, Postgres boundary, and startup migrations |

## Related code

- `src/app/(workspace)/expense/`
- `src/app/api/expense/management/route.ts`
- `src/components/expense/`
- `src/lib/expense/persistence.ts`
- `src/lib/expense/db/migrate-on-startup.ts`
- `src/instrumentation.ts`
- `src/lib/expense/drive/config.ts`
- `src/types/expense/request-status.ts`

/**
 * Persistence boundary for business modules.
 * Timesheet stays on Google Sheets. Expense must use its own transactional
 * database when that module is implemented. SQL migrations run at server start
 * only when EXPENSE_DATABASE_URL is set (`src/lib/expense/db`).
 */
export const MODULE_PERSISTENCE = {
  timesheet: 'google-sheets',
  expense: 'dedicated-transactional-database',
} as const;

export type ModulePersistence =
  (typeof MODULE_PERSISTENCE)[keyof typeof MODULE_PERSISTENCE];

export function expensePersistenceBoundary(): ModulePersistence {
  return MODULE_PERSISTENCE.expense;
}

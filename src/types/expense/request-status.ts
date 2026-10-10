/**
 * Expense item lifecycle.
 * SUBMITTED means the employee sent the item. It does not mean approved or paid.
 */
export type ExpenseRequestStatus = 'DRAFT' | 'SUBMITTED' | 'PAID' | 'CANCELLED';

export const EXPENSE_REQUEST_STATUSES: readonly ExpenseRequestStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'PAID',
  'CANCELLED',
];

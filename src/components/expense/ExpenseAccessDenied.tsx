import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export function ExpenseAccessDenied() {
  return (
    <div className="container mx-auto px-4 py-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Expense Management</h2>
      <p className="mt-3 max-w-2xl text-gray-700 dark:text-gray-300">
        You do not have access to Expense Management. This area is limited to HR & Financial and Administrator.
      </p>
      <a
        href={WORKSPACE_ROUTES.expenseMine}
        className="mt-6 inline-block text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-300"
      >
        Back to My Expenses
      </a>
    </div>
  );
}

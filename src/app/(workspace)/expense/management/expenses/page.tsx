'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PrototypeBanner, useExpenseWorkspace, WorkspaceStatus } from '@/components/expense/prototype/ExpenseProvider';
import { ExpenseList } from '@/components/expense/prototype/ExpenseList';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

function AllExpenses() {
  const workspace = useExpenseWorkspace();
  const params = useSearchParams();
  const employee = params.get('employee');
  const month = params.get('month');
  const expenses = workspace.expenses.filter((entry) => {
    if (entry.status === 'DRAFT') return false;
    if (employee && entry.employeeId !== employee) return false;
    if (month && !entry.expenseDate.startsWith(month)) return false;
    return true;
  });
  return (
    <ExpenseList
      title="All Expenses"
      expenses={expenses}
      employeeScope={false}
      statusOptions={['SUBMITTED', 'PAID', 'CANCELLED']}
      detailHref={(entry) => `${WORKSPACE_ROUTES.expenseManagementExpenses}/${entry.id}`}
    />
  );
}

export default function AllExpensesPage() {
  const workspace = useExpenseWorkspace();
  return (
    <div className="container mx-auto px-4 py-6">
      <PrototypeBanner />
      <WorkspaceStatus />
      {workspace.ready && !workspace.error ? (
        <Suspense fallback={<p className="text-gray-700 dark:text-gray-300">Loading filters…</p>}>
          <AllExpenses />
        </Suspense>
      ) : null}
    </div>
  );
}

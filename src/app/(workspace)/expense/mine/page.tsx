'use client';

import Link from 'next/link';
import { PrototypeBanner, useExpenseWorkspace, WorkspaceStatus } from '@/components/expense/prototype/ExpenseProvider';
import { ExpenseList } from '@/components/expense/prototype/ExpenseList';
import { expenseSecondaryButtonClass } from '@/components/expense/prototype/fields';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export default function MyExpensesPage() {
  const workspace = useExpenseWorkspace();
  return (
    <div className="container mx-auto px-4 py-6">
      <PrototypeBanner showEmployeeSwitch />
      <WorkspaceStatus />
      {workspace.ready && !workspace.error ? (
        <ExpenseList
          title="My Expenses"
          expenses={workspace.expenses}
          employeeScope
          detailHref={(entry) => `${WORKSPACE_ROUTES.expenseMine}/${entry.id}`}
          headerAction={
            <Link href={WORKSPACE_ROUTES.expenseNew} className={expenseSecondaryButtonClass}>
              Add expense
            </Link>
          }
        />
      ) : null}
    </div>
  );
}

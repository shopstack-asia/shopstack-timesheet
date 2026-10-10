'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExpenseForm } from '@/components/expense/prototype/ExpenseForm';
import { PrototypeBanner, useExpenseWorkspace, WorkspaceStatus } from '@/components/expense/prototype/ExpenseProvider';
import { expenseNeutralButtonClass } from '@/components/expense/prototype/fields';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export default function AddExpensePage() {
  const workspace = useExpenseWorkspace();
  const router = useRouter();
  return (
    <div className="container mx-auto px-4 py-6">
      <PrototypeBanner showEmployeeSwitch />
      <WorkspaceStatus />
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Add Expense</h2>
        <Link href={WORKSPACE_ROUTES.expenseMine} className={expenseNeutralButtonClass}>Back</Link>
      </div>
      {workspace.ready && !workspace.error ? (
        <ExpenseForm
          employeeId={workspace.actingEmployeeId}
          onSave={async (input) => {
            const entry = await workspace.saveNew({ ...input, employeeId: workspace.actingEmployeeId });
            router.push(`${WORKSPACE_ROUTES.expenseMine}/${entry.id}`);
          }}
        />
      ) : null}
    </div>
  );
}

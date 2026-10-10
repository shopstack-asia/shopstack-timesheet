'use client';

import { CategoryManager } from '@/components/expense/prototype/CategoryManager';
import { PrototypeBanner, useExpenseWorkspace, WorkspaceStatus } from '@/components/expense/prototype/ExpenseProvider';

export default function ManageCategoryPage() {
  const workspace = useExpenseWorkspace();
  return (
    <div className="container mx-auto px-4 py-6">
      <PrototypeBanner />
      <WorkspaceStatus />
      {workspace.ready && !workspace.error ? <CategoryManager /> : null}
    </div>
  );
}

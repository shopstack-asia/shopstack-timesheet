'use client';

import { ClaimIndex } from '@/components/expense/prototype/HrExpenseScreens';
import { PrototypeBanner, useExpenseWorkspace, WorkspaceStatus } from '@/components/expense/prototype/ExpenseProvider';

export default function ExpenseClaimsPage() {
  const workspace = useExpenseWorkspace();
  return (
    <div className="container mx-auto px-4 py-6">
      <PrototypeBanner />
      <WorkspaceStatus />
      {workspace.ready && !workspace.error ? <ClaimIndex mine={false} /> : null}
    </div>
  );
}

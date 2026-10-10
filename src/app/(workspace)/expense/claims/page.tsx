'use client';

import { ClaimIndex } from '@/components/expense/prototype/HrExpenseScreens';
import { PrototypeBanner, WorkspaceStatus, useExpenseWorkspace } from '@/components/expense/prototype/ExpenseProvider';

export default function MyClaimsPage() {
  const workspace = useExpenseWorkspace();
  return (
    <div className="container mx-auto px-4 py-6">
      <PrototypeBanner showEmployeeSwitch />
      <WorkspaceStatus />
      {workspace.ready && !workspace.error ? <ClaimIndex mine /> : null}
    </div>
  );
}

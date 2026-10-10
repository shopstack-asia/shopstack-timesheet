'use client';

import { useParams } from 'next/navigation';
import { ClaimDocument } from '@/components/expense/prototype/ClaimDocument';
import { PrototypeBanner, useExpenseWorkspace, WorkspaceStatus } from '@/components/expense/prototype/ExpenseProvider';

export default function HrClaimPage() {
  const params = useParams<{ id: string }>();
  const workspace = useExpenseWorkspace();
  const claim = workspace.claims.find((item) => item.id === params.id);
  return (
    <div className="container mx-auto px-4 py-6">
      <PrototypeBanner />
      <WorkspaceStatus />
      {workspace.ready && !workspace.error ? (
        claim ? <ClaimDocument claim={claim} /> : <p className="text-gray-700 dark:text-gray-300">Claim not found in this browser.</p>
      ) : null}
    </div>
  );
}

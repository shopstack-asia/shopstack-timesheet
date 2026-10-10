'use client';

import { Suspense, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClaimFormSheet } from '@/components/expense/prototype/ClaimFormSheet';
import { PrototypeBanner, useExpenseWorkspace, WorkspaceStatus } from '@/components/expense/prototype/ExpenseProvider';
import { expenseBusyLabel, expenseNeutralButtonClass, expensePrimaryButtonClass } from '@/components/expense/prototype/fields';
import { addThb } from '@/lib/expense/prototype/money';
import { eligibleClaimExpenses } from '@/lib/expense/prototype/service';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

function ClaimPreview() {
  const params = useSearchParams();
  const router = useRouter();
  const workspace = useExpenseWorkspace();
  const [message, setMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const generateLock = useRef(false);
  const requestedEmployeeId = params.get('employee') ?? '';
  const sample = workspace.expenses.find((entry) => entry.employeeId === requestedEmployeeId);
  const employee = sample
    ? {
        id: sample.employeeId,
        code: sample.employeeCode,
        name: sample.employeeName,
        businessUnit: sample.businessUnit,
      }
    : undefined;
  const monthValue = params.get('month') ?? '';
  const purpose = params.get('purpose')?.trim() || 'Monthly expense claim';
  const claimDate = new Date().toISOString().slice(0, 10);
  const [year, month] = monthValue.split('-').map(Number);
  const entries =
    employee && Number.isInteger(year) && Number.isInteger(month)
      ? eligibleClaimExpenses(workspace.expenses, employee.id, year, month)
      : [];
  const form = employee
    ? {
        claimNumber: '',
        employeeName: employee.name,
        businessUnit: employee.businessUnit,
        purpose,
        claimDate,
        rows: entries.map((entry) => ({
          date: entry.expenseDate,
          expense: workspace.categories.find((category) => category.code === entry.categoryCode)?.name ?? entry.categoryCode,
          code: entry.categoryCode,
          explanation: entry.description,
          currency: entry.currency,
          amount: entry.amount,
          exchangeRate: entry.exchangeRate,
          amountThb: entry.amountThb,
        })),
        totalThb: entries.reduce((sum, entry) => addThb(sum, entry.amountThb), '0.00'),
      }
    : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Claim preview</h2>
        <div className="flex flex-wrap gap-2">
          {employee && entries.length > 0 ? (
            <button
              type="button"
              className={expensePrimaryButtonClass}
              disabled={generating}
              aria-busy={generating}
              onClick={() => {
                if (generateLock.current) return;
                generateLock.current = true;
                setMessage(null);
                setGenerating(true);
                void workspace
                  .generateClaim({ employeeId: employee.id, year, month, purpose, claimDate })
                  .then((claim) => {
                    router.push(`${WORKSPACE_ROUTES.expenseManagementClaims}/${claim.id}`);
                  })
                  .catch((error: unknown) => {
                    setMessage(error instanceof Error ? error.message : 'Could not generate the claim');
                    generateLock.current = false;
                    setGenerating(false);
                  });
              }}
            >
              {generating ? expenseBusyLabel('generate') : 'Generate'}
            </button>
          ) : null}
          <Link href={WORKSPACE_ROUTES.expenseManagementSummary} className={expenseNeutralButtonClass}>Back</Link>
        </div>
      </div>
      {message ? <p className="mt-3 text-sm text-red-700 dark:text-red-300">{message}</p> : null}
      {!employee || !form ? (
        <p className="mt-4 text-gray-700 dark:text-gray-300">Choose an employee from Monthly Summary.</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">Requester {employee.code} · {employee.name}</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">A claim number is issued when you generate the monthly claim.</p>
          {entries.length === 0 ? (
            <p className="mt-4 text-gray-700 dark:text-gray-300">No submitted expenses are available for this employee and month.</p>
          ) : (
            <ClaimFormSheet form={form} />
          )}
        </>
      )}
    </div>
  );
}

export default function ClaimPreviewPage() {
  const workspace = useExpenseWorkspace();
  return (
    <div className="container mx-auto px-4 py-6">
      <PrototypeBanner />
      <WorkspaceStatus />
      {workspace.ready && !workspace.error ? (
        <Suspense fallback={<p className="text-gray-700 dark:text-gray-300">Loading preview…</p>}>
          <ClaimPreview />
        </Suspense>
      ) : null}
    </div>
  );
}

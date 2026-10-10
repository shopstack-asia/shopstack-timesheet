'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ClaimFormSheet } from '@/components/expense/prototype/ClaimFormSheet';
import { StatusPill } from '@/components/expense/prototype/ExpenseList';
import { useExpenseWorkspace } from '@/components/expense/prototype/ExpenseProvider';
import { claimFormInput, downloadClaimPackage, printClaimPackage } from '@/components/expense/prototype/claim-files';
import { expenseBusyLabel, expenseNeutralButtonClass, expensePrimaryButtonClass, expenseSecondaryButtonClass, type ExpenseActionName } from '@/components/expense/prototype/fields';
import { useWorkspaceAccess } from '@/components/workspace/layout/WorkspaceFrame';
import { hasWorkspaceRole } from '@/lib/workspace/authorization';
import type { MonthlyExpenseClaim } from '@/lib/expense/prototype/types';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export function ClaimDocument({ claim }: { claim: MonthlyExpenseClaim }) {
  const workspace = useExpenseWorkspace();
  const router = useRouter();
  const isAdmin = hasWorkspaceRole(useWorkspaceAccess().roles, ['ADMIN']);
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ExpenseActionName | null>(null);
  const busyLock = useRef(false);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const managementClaim = pathname.startsWith(WORKSPACE_ROUTES.expenseManagementClaims);
  const backHref = managementClaim ? WORKSPACE_ROUTES.expenseManagementClaims : WORKSPACE_ROUTES.expenseMyClaims;
  let form: ReturnType<typeof claimFormInput> | null = null;
  let formError: string | null = null;
  try {
    form = claimFormInput(claim, workspace.expenses, workspace.categories);
  } catch (cause) {
    formError = cause instanceof Error ? cause.message : 'Could not build the claim form';
  }

  const run = async (label: ExpenseActionName, action: () => Promise<void>) => {
    if (busyLock.current) return false;
    busyLock.current = true;
    setBusy(label);
    setError(null);
    try {
      await action();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete the action');
      return false;
    } finally {
      busyLock.current = false;
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{claim.claimNumber}</h2>
          <StatusPill status={claim.status} />
        </div>
        <Link href={backHref} className={expenseNeutralButtonClass}>Back</Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {managementClaim && claim.status === 'PROCESSING' ? (
          <button type="button" className={expenseSecondaryButtonClass} disabled={busy !== null} onClick={() => setConfirmPaid(true)}>
            Mark paid
          </button>
        ) : null}
        <button
          type="button"
          className={expenseNeutralButtonClass}
          disabled={busy !== null || !form}
          aria-busy={busy === 'download'}
          onClick={() => void run('download', () => downloadClaimPackage(claim, workspace.expenses, workspace.categories, workspace.database))}
        >
          {busy === 'download' ? expenseBusyLabel('download') : 'Download'}
        </button>
        <button
          type="button"
          className={expensePrimaryButtonClass}
          disabled={busy !== null || !form}
          aria-busy={busy === 'print'}
          onClick={() => void run('print', () => printClaimPackage(claim, workspace.expenses, workspace.categories, workspace.database))}
        >
          {busy === 'print' ? expenseBusyLabel('print') : 'Print'}
        </button>
        {isAdmin ? (
          <button type="button" className={expenseNeutralButtonClass} disabled={busy !== null} onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        ) : null}
      </div>
      {busy === 'download' || busy === 'print' ? <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{expenseBusyLabel(busy)}</p> : null}
      {formError || error ? <p className="mt-3 text-sm text-red-700 dark:text-red-300">{formError ?? error}</p> : null}
      {form ? <ClaimFormSheet form={form} /> : null}
      {confirmPaid ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={() => { if (!busy) setConfirmPaid(false); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="claim-detail-paid-title"
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="claim-detail-paid-title" className="text-lg font-semibold text-gray-900 dark:text-white">Mark this claim paid?</h3>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              {claim.claimNumber} and every expense on it will be marked paid.
            </p>
            {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={expenseNeutralButtonClass} disabled={busy !== null} onClick={() => setConfirmPaid(false)}>Back</button>
              <button
                type="button"
                className={expensePrimaryButtonClass}
                disabled={busy !== null}
                aria-busy={busy === 'paid'}
                onClick={() => {
                  void run('paid', () => workspace.markClaimPaid(claim.id)).then((done) => {
                    if (done) setConfirmPaid(false);
                  });
                }}
              >
                {busy === 'paid' ? expenseBusyLabel('paid') : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={() => { if (!busy) setConfirmDelete(false); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="claim-detail-delete-title"
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="claim-detail-delete-title" className="text-lg font-semibold text-gray-900 dark:text-white">Delete this claim?</h3>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              {claim.claimNumber} will be removed. The expenses stay, without this claim.
            </p>
            {error ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={expenseNeutralButtonClass} disabled={busy !== null} onClick={() => setConfirmDelete(false)}>Back</button>
              <button
                type="button"
                className={expensePrimaryButtonClass}
                disabled={busy !== null}
                aria-busy={busy === 'delete'}
                onClick={() => {
                  void run('delete', async () => {
                    await workspace.removeClaim(claim.id);
                    router.push(backHref);
                  }).then((done) => {
                    if (done) setConfirmDelete(false);
                  });
                }}
              >
                {busy === 'delete' ? expenseBusyLabel('delete') : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { ExpenseForm } from '@/components/expense/prototype/ExpenseForm';
import { PrototypeBanner, useExpenseWorkspace, WorkspaceStatus } from '@/components/expense/prototype/ExpenseProvider';
import { expenseBusyLabel, expenseNeutralButtonClass, expensePrimaryButtonClass } from '@/components/expense/prototype/fields';
import { useWorkspaceAccess } from '@/components/workspace/layout/WorkspaceFrame';
import { hasWorkspaceRole } from '@/lib/workspace/authorization';
import type { AttachmentMeta } from '@/lib/expense/prototype/types';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export default function ExpenseDetailPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const workspace = useExpenseWorkspace();
  const isAdmin = hasWorkspaceRole(useWorkspaceAccess().roles, ['ADMIN']);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteLock = useRef(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const entry = workspace.expenses.find((item) => item.id === params.id);
  const fromAllExpenses = pathname.startsWith(WORKSPACE_ROUTES.expenseManagementExpenses);
  const backHref = fromAllExpenses ? WORKSPACE_ROUTES.expenseManagementExpenses : WORKSPACE_ROUTES.expenseMine;
  const requester = entry
    ? { code: entry.employeeCode, name: entry.employeeName }
    : undefined;
  const claimNumber = entry?.claimId
    ? workspace.claims.find((claim) => claim.id === entry.claimId)?.claimNumber
    : undefined;
  const [attachments, setAttachments] = useState<AttachmentMeta[] | null>(null);

  useEffect(() => {
    if (!workspace.database || !params.id) return;
    let active = true;
    setAttachments(null);
    void workspace.database.listAttachments(params.id).then((items) => {
      if (active) setAttachments(items);
    });
    return () => {
      active = false;
    };
  }, [params.id, workspace.database, workspace.expenses]);

  return (
    <div className="container mx-auto px-4 py-6">
      <PrototypeBanner showEmployeeSwitch />
      <WorkspaceStatus />
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          {!entry ? 'Expense' : entry.status === 'DRAFT' ? 'Edit draft' : entry.description}
        </h2>
        <div className="flex items-center gap-2">
          {isAdmin && entry ? (
            <button type="button" className={expenseNeutralButtonClass} disabled={deleting} onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          ) : null}
          <Link href={backHref} className={expenseNeutralButtonClass}>Back</Link>
        </div>
      </div>
      {entry?.requestNumber ? (
        <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">Request {entry.requestNumber}</p>
      ) : null}
      {fromAllExpenses && requester ? (
        <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">Requester {requester.code} · {requester.name}</p>
      ) : null}
      {entry && entry.status !== 'DRAFT' ? (
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
          {entry.status}
          {claimNumber ? ` · ${claimNumber}` : ''}
        </p>
      ) : null}
      {!workspace.ready || workspace.error || (entry && attachments === null) ? null : !entry ? (
        <p className="text-gray-700 dark:text-gray-300">Expense not found.</p>
      ) : (
        <ExpenseForm
          key={entry.id}
          employeeId={entry.employeeId}
          initial={entry}
          existingAttachments={attachments ?? []}
          readOnly={entry.status !== 'DRAFT'}
          onSave={
            entry.status === 'DRAFT'
              ? async (input) => {
                  await workspace.saveDraft(entry.id, input);
                  router.push(backHref);
                }
              : undefined
          }
        />
      )}
      {confirmDelete && entry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={() => { if (!deleting) setConfirmDelete(false); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="expense-detail-delete-title"
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="expense-detail-delete-title" className="text-lg font-semibold text-gray-900 dark:text-white">Delete this expense?</h3>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{entry.description}</p>
            {deleteError ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{deleteError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={expenseNeutralButtonClass} disabled={deleting} onClick={() => setConfirmDelete(false)}>Back</button>
              <button
                type="button"
                className={expensePrimaryButtonClass}
                disabled={deleting}
                aria-busy={deleting}
                onClick={() => {
                  if (deleteLock.current) return;
                  deleteLock.current = true;
                  setDeleting(true);
                  setDeleteError(null);
                  void workspace.removeDraft(entry.id)
                    .then(() => router.push(backHref))
                    .catch((cause: unknown) => {
                      setDeleteError(cause instanceof Error ? cause.message : 'Could not delete the expense');
                      deleteLock.current = false;
                      setDeleting(false);
                    });
                }}
              >
                {deleting ? expenseBusyLabel('delete') : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/expense/prototype/money';
import { groupEligibleClaimExpenses } from '@/lib/expense/prototype/service';
import { useExpenseWorkspace } from '@/components/expense/prototype/ExpenseProvider';
import { StatusPill, claimCardClass } from '@/components/expense/prototype/ExpenseList';
import { expenseBusyLabel, expenseInputClass, expenseNeutralButtonClass, expensePrimaryButtonClass, expenseSecondaryButtonClass, type ExpenseActionName } from '@/components/expense/prototype/fields';
import SearchableSelect from '@/components/SearchableSelect';
import { MonthField, MultiSelect } from '@/components/expense/prototype/pickers';
import { downloadClaimPackage, downloadClaimPackages, printClaimPackage, printClaimPackages } from '@/components/expense/prototype/claim-files';
import type { ClaimStatus } from '@/lib/expense/prototype/types';
import { useWorkspaceAccess } from '@/components/workspace/layout/WorkspaceFrame';
import { hasWorkspaceRole } from '@/lib/workspace/authorization';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export function MonthlySummary() {
  const workspace = useExpenseWorkspace();
  const router = useRouter();
  const [monthValue, setMonthValue] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [employeeId, setEmployeeId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const generateLock = useRef(false);
  const [purpose, setPurpose] = useState('Monthly expense claim');
  const [year, month] = monthValue.split('-').map(Number);

  const groups = useMemo(
    () => groupEligibleClaimExpenses(workspace.expenses, year, month),
    [month, workspace.expenses, year]
  );
  const rows = employeeId ? groups.filter((group) => group.employeeId === employeeId) : groups;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Monthly Summary</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        <MonthField value={monthValue} onChange={setMonthValue} placeholder="Month" allowClear={false} />
        <div className="min-w-[12rem]">
          <SearchableSelect
            value={employeeId}
            onChange={setEmployeeId}
            placeholder="All employees"
            options={[
              { value: '', label: 'All employees' },
              ...groups.map((group) => ({ value: group.employeeId, label: group.employeeName })),
            ]}
          />
        </div>
        <input value={purpose} onChange={(event) => setPurpose(event.target.value)} className={`${expenseInputClass({ fullWidth: false })} min-w-[16rem]`} />
      </div>
      {message ? <p className="mt-3 text-sm text-red-700 dark:text-red-300">{message}</p> : null}
      {rows.length === 0 ? (
        <p className="mt-6 text-gray-600 dark:text-gray-300">No submitted expenses are waiting for this month.</p>
      ) : null}
      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li key={row.employeeId} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <p className="font-medium text-gray-900 dark:text-white">{row.employeeName} · {row.businessUnit}</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">{row.entries.length} eligible entries · {formatMoney(row.totalThb)} THB</p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <Link
                className={expenseSecondaryButtonClass}
                href={`${WORKSPACE_ROUTES.expenseManagementSummaryPreview}?employee=${row.employeeId}&month=${monthValue}&purpose=${encodeURIComponent(purpose)}`}
              >
                View expenses
              </Link>
              <button
                type="button"
                className={expensePrimaryButtonClass}
                disabled={generatingId !== null}
                aria-busy={generatingId === row.employeeId}
                onClick={() => {
                  if (generateLock.current) return;
                  generateLock.current = true;
                  setGeneratingId(row.employeeId);
                  setMessage(null);
                  void workspace.generateClaim({
                    employeeId: row.employeeId,
                    year,
                    month,
                    purpose,
                    claimDate: new Date().toISOString().slice(0, 10),
                  }).then((claim) => {
                    router.push(`${WORKSPACE_ROUTES.expenseManagementClaims}/${claim.id}`);
                  }).catch((error: unknown) => {
                    setMessage(error instanceof Error ? error.message : 'Could not generate the claim');
                    generateLock.current = false;
                    setGeneratingId(null);
                  });
                }}
              >
                {generatingId === row.employeeId ? expenseBusyLabel('generate') : 'Generate monthly claim'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ClaimIndex({ mine }: { mine: boolean }) {
  const workspace = useExpenseWorkspace();
  const isAdmin = hasWorkspaceRole(useWorkspaceAccess().roles, ['ADMIN']);
  const [month, setMonth] = useState('');
  const [statuses, setStatuses] = useState<ClaimStatus[]>([]);
  const [busy, setBusy] = useState<{ scope: string; action: ExpenseActionName } | null>(null);
  const busyLock = useRef(false);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingPaid, setPendingPaid] = useState<Array<{ id: string; claimNumber: string }> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; claimNumber: string } | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const claims = useMemo(() => {
    const [year, monthNumber] = month.split('-').map(Number);
    return workspace.claims
      .filter((claim) => (mine ? claim.employeeId === workspace.actingEmployeeId : true))
      .filter((claim) => (month ? claim.year === year && claim.month === monthNumber : true))
      .filter((claim) => (statuses.length === 0 ? true : statuses.includes(claim.status)))
      .sort((a, b) => b.claimNumber.localeCompare(a.claimNumber));
  }, [mine, month, statuses, workspace.actingEmployeeId, workspace.claims]);
  const hasScopedClaims = workspace.claims.some((claim) => (mine ? claim.employeeId === workspace.actingEmployeeId : true));
  const selected = claims.filter((claim) => selectedIds.includes(claim.id));
  const payable = selected.filter((claim) => claim.status === 'PROCESSING');
  const allVisibleSelected = claims.length > 0 && claims.every((claim) => selectedIds.includes(claim.id));
  const base = mine ? WORKSPACE_ROUTES.expenseMyClaims : WORKSPACE_ROUTES.expenseManagementClaims;
  const toggleSelected = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };
  const begin = (next: { scope: string; action: ExpenseActionName }) => {
    if (busyLock.current) return false;
    busyLock.current = true;
    setBusy(next);
    return true;
  };
  const finish = () => {
    busyLock.current = false;
    setBusy(null);
  };
  const runBatch = (actionName: ExpenseActionName, action: () => Promise<void>) => {
    if (!begin({ scope: 'batch', action: actionName })) return;
    setBatchError(null);
    void action()
      .catch((cause: unknown) => {
        setBatchError(cause instanceof Error ? cause.message : 'Could not prepare the selected claims');
      })
      .finally(finish);
  };
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{mine ? 'My Monthly Claims' : 'Expense Claims'}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MonthField value={month} onChange={setMonth} />
        <MultiSelect
          values={statuses}
          onChange={(next) => setStatuses(next as ClaimStatus[])}
          placeholder="All statuses"
          options={[
            { value: 'PROCESSING', label: 'Processing' },
            { value: 'PAID', label: 'Paid' },
          ]}
        />
      </div>
      {claims.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-blue-600"
              checked={allVisibleSelected}
              onChange={() => {
                const visibleIds = claims.map((claim) => claim.id);
                setSelectedIds((current) =>
                  allVisibleSelected
                    ? current.filter((id) => !visibleIds.includes(id))
                    : [...new Set([...current, ...visibleIds])]
                );
              }}
              aria-label="Select visible claims"
            />
            {selected.length === 0 ? 'Select claims' : `${selected.length} selected`}
          </label>
          <button
            type="button"
            className={expenseNeutralButtonClass}
            disabled={busy !== null || selected.length === 0}
            aria-busy={busy?.scope === 'batch' && busy.action === 'download'}
            onClick={() => runBatch('download', () => downloadClaimPackages(selected, workspace.expenses, workspace.categories, workspace.database))}
          >
            {busy?.scope === 'batch' && busy.action === 'download' ? expenseBusyLabel('download') : 'Download'}
          </button>
          <button
            type="button"
            className={expenseSecondaryButtonClass}
            disabled={busy !== null || selected.length === 0}
            aria-busy={busy?.scope === 'batch' && busy.action === 'print'}
            onClick={() => runBatch('print', () => printClaimPackages(selected, workspace.expenses, workspace.categories, workspace.database))}
          >
            {busy?.scope === 'batch' && busy.action === 'print' ? expenseBusyLabel('print') : 'Print'}
          </button>
          {!mine ? (
            <button
              type="button"
              className={expenseSecondaryButtonClass}
              disabled={busy !== null || payable.length === 0}
              onClick={() => {
                setDialogError(null);
                setPendingPaid(payable.map((claim) => ({ id: claim.id, claimNumber: claim.claimNumber })));
              }}
            >
              Mark paid
            </button>
          ) : null}
        </div>
      ) : null}
      {batchError ? <p className="mt-3 text-sm text-red-700 dark:text-red-300">{batchError}</p> : null}
      {claims.length === 0 ? (
        <p className="mt-6 text-gray-600 dark:text-gray-300">
          {hasScopedClaims ? 'No claims match these filters.' : 'No monthly claims yet.'}
        </p>
      ) : null}
      <ul className="mt-4 space-y-3">
        {claims.map((claim) => (
          <li key={claim.id} className={claimCardClass(claim.status)}>
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600"
                checked={selectedIds.includes(claim.id)}
                onChange={() => toggleSelected(claim.id)}
                aria-label={`Select ${claim.claimNumber}`}
              />
              <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{claim.claimNumber}</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {claim.employeeName} · {claim.year}-{String(claim.month).padStart(2, '0')} · {formatMoney(claim.totalThb)} THB · {claim.expenseIds.length} entries
                </p>
              </div>
              <StatusPill status={claim.status} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 pl-7">
              <Link href={`${base}/${claim.id}`} className={expenseSecondaryButtonClass}>Open claim</Link>
              {!mine && claim.status === 'PROCESSING' ? (
                <button
                  type="button"
                  className={expenseSecondaryButtonClass}
                  disabled={busy !== null}
                  onClick={() => {
                    setDialogError(null);
                    setPendingPaid([{ id: claim.id, claimNumber: claim.claimNumber }]);
                  }}
                >
                  Mark paid
                </button>
              ) : null}
              <button
                type="button"
                className={expenseNeutralButtonClass}
                disabled={busy !== null}
                aria-busy={busy?.scope === claim.id && busy.action === 'download'}
                onClick={() => {
                  if (!begin({ scope: claim.id, action: 'download' })) return;
                  setRowError(null);
                  void downloadClaimPackage(claim, workspace.expenses, workspace.categories, workspace.database)
                    .catch((cause: unknown) => {
                      setRowError({ id: claim.id, message: cause instanceof Error ? cause.message : 'Could not download the claim' });
                    })
                    .finally(finish);
                }}
              >
                {busy?.scope === claim.id && busy.action === 'download' ? expenseBusyLabel('download') : 'Download'}
              </button>
              <button
                type="button"
                className={expenseSecondaryButtonClass}
                disabled={busy !== null}
                aria-busy={busy?.scope === claim.id && busy.action === 'print'}
                onClick={() => {
                  if (!begin({ scope: claim.id, action: 'print' })) return;
                  setRowError(null);
                  void printClaimPackage(claim, workspace.expenses, workspace.categories, workspace.database)
                    .catch((cause: unknown) => {
                      setRowError({ id: claim.id, message: cause instanceof Error ? cause.message : 'Could not print the claim' });
                    })
                    .finally(finish);
                }}
              >
                {busy?.scope === claim.id && busy.action === 'print' ? expenseBusyLabel('print') : 'Print'}
              </button>
              {isAdmin ? (
                <button
                  type="button"
                  className={expenseNeutralButtonClass}
                  disabled={busy !== null}
                  onClick={() => {
                    setDialogError(null);
                    setPendingDelete({ id: claim.id, claimNumber: claim.claimNumber });
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>
            {rowError?.id === claim.id ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{rowError.message}</p> : null}
          </li>
        ))}
      </ul>
      {pendingPaid ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={() => { if (!busy) setPendingPaid(null); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="claim-paid-title"
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="claim-paid-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              {pendingPaid.length === 1 ? 'Mark this claim paid?' : `Mark ${pendingPaid.length} claims paid?`}
            </h3>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              {pendingPaid.map((item) => item.claimNumber).join(', ')} and every expense on {pendingPaid.length === 1 ? 'it' : 'them'} will be marked paid.
            </p>
            {dialogError ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{dialogError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={expenseNeutralButtonClass} disabled={busy !== null} onClick={() => setPendingPaid(null)}>Back</button>
              <button
                type="button"
                className={expensePrimaryButtonClass}
                disabled={busy !== null}
                aria-busy={busy?.action === 'paid'}
                onClick={() => {
                  if (!pendingPaid || !begin({ scope: 'batch', action: 'paid' })) return;
                  const current = pendingPaid;
                  setDialogError(null);
                  void (async () => {
                    for (const item of current) {
                      await workspace.markClaimPaid(item.id);
                    }
                    setSelectedIds((ids) => ids.filter((id) => !current.some((item) => item.id === id)));
                    setPendingPaid(null);
                  })()
                    .catch((cause: unknown) => {
                      setDialogError(cause instanceof Error ? cause.message : 'Could not mark the claims paid');
                    })
                    .finally(finish);
                }}
              >
                {busy?.action === 'paid' ? expenseBusyLabel('paid') : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={() => { if (!busy) setPendingDelete(null); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="claim-delete-title"
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="claim-delete-title" className="text-lg font-semibold text-gray-900 dark:text-white">Delete this claim?</h3>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              {pendingDelete.claimNumber} will be removed. The expenses stay, without this claim.
            </p>
            {dialogError ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{dialogError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={expenseNeutralButtonClass} disabled={busy !== null} onClick={() => setPendingDelete(null)}>Back</button>
              <button
                type="button"
                className={expensePrimaryButtonClass}
                disabled={busy !== null}
                aria-busy={busy?.action === 'delete'}
                onClick={() => {
                  if (!pendingDelete || !begin({ scope: pendingDelete.id, action: 'delete' })) return;
                  const current = pendingDelete;
                  setDialogError(null);
                  void workspace.removeClaim(current.id)
                    .then(() => setPendingDelete(null))
                    .catch((cause: unknown) => {
                      setDialogError(cause instanceof Error ? cause.message : 'Could not delete the claim');
                    })
                    .finally(finish);
                }}
              >
                {busy?.action === 'delete' ? expenseBusyLabel('delete') : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

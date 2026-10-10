'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { formatMoney } from '@/lib/expense/prototype/money';
import type { ClaimStatus, ExpenseEntry, ExpenseEntryStatus } from '@/lib/expense/prototype/types';
import { useExpenseWorkspace } from '@/components/expense/prototype/ExpenseProvider';
import { expenseBusyLabel, expenseInputClass, expenseNeutralButtonClass, expensePrimaryButtonClass, expenseSecondaryButtonClass, type ExpenseActionName } from '@/components/expense/prototype/fields';
import { MonthField, MultiSelect } from '@/components/expense/prototype/pickers';
import { useWorkspaceAccess } from '@/components/workspace/layout/WorkspaceFrame';
import { hasWorkspaceRole } from '@/lib/workspace/authorization';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

const SURFACE = {
  submitted: 'bg-sky-50 dark:bg-sky-950/40',
  paid: 'bg-green-50 dark:bg-green-950/40',
  cancelled: 'bg-amber-50 dark:bg-amber-950/40',
  plain: 'bg-white dark:bg-gray-800',
} as const;

function cardClass(background: string): string {
  return `rounded-lg border border-gray-200 p-4 dark:border-gray-700 ${background}`;
}

function expenseCardClass(status: ExpenseEntryStatus): string {
  if (status === 'SUBMITTED') return cardClass(SURFACE.submitted);
  if (status === 'PAID') return cardClass(SURFACE.paid);
  if (status === 'CANCELLED') return cardClass(SURFACE.cancelled);
  return cardClass(SURFACE.plain);
}

export function claimCardClass(status: ClaimStatus): string {
  if (status === 'PAID') return cardClass(SURFACE.paid);
  return cardClass(SURFACE.plain);
}

const STATUS_OPTIONS: Array<{ value: ExpenseEntryStatus; label: string }> = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'PAID', label: 'Paid' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function ExpenseList({
  title,
  expenses,
  detailHref,
  employeeScope,
  headerAction,
  statusOptions = STATUS_OPTIONS.map((option) => option.value),
}: {
  title: string;
  expenses: ExpenseEntry[];
  detailHref: (entry: ExpenseEntry) => string;
  employeeScope: boolean;
  headerAction?: React.ReactNode;
  statusOptions?: ExpenseEntryStatus[];
}) {
  const workspace = useExpenseWorkspace();
  const isAdmin = hasWorkspaceRole(useWorkspaceAccess().roles, ['ADMIN']);
  const [month, setMonth] = useState('');
  const [statuses, setStatuses] = useState<ExpenseEntryStatus[]>([]);
  const [categoryCodes, setCategoryCodes] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    id: string;
    action: 'submit' | 'delete' | 'cancel';
    description: string;
  } | null>(null);
  const [acting, setActing] = useState<ExpenseActionName | null>(null);
  const actingLock = useRef(false);

  const visible = useMemo(() => {
    return expenses
      .filter((entry) => (employeeScope ? entry.employeeId === workspace.actingEmployeeId : true))
      .filter((entry) => (month ? entry.expenseDate.startsWith(month) : true))
      .filter((entry) => (statuses.length === 0 ? true : statuses.includes(entry.status)))
      .filter((entry) => (categoryCodes.length === 0 ? true : categoryCodes.includes(entry.categoryCode)))
      .filter((entry) => entry.description.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
  }, [categoryCodes, employeeScope, expenses, month, query, statuses, workspace.actingEmployeeId]);

  const confirmPending = async () => {
    if (!pending || actingLock.current) return;
    const current = pending;
    actingLock.current = true;
    setActing(current.action);
    setMessage(null);
    try {
      if (current.action === 'submit') await workspace.submit(current.id);
      if (current.action === 'delete') await workspace.removeDraft(current.id);
      if (current.action === 'cancel') await workspace.cancel(current.id);
      setPending(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed');
    } finally {
      actingLock.current = false;
      setActing(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h2>
        {headerAction}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MonthField value={month} onChange={setMonth} />
        <MultiSelect
          values={statuses}
          onChange={(next) => setStatuses(next as ExpenseEntryStatus[])}
          placeholder="All statuses"
          options={STATUS_OPTIONS.filter((option) => statusOptions.includes(option.value))}
        />
        <MultiSelect
          values={categoryCodes}
          onChange={setCategoryCodes}
          placeholder="All categories"
          options={workspace.categories.map((category) => ({
            value: category.code,
            label: `${category.code} ${category.name}`,
          }))}
        />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search description" className={expenseInputClass()} />
      </div>
      {message ? <p className="mt-3 text-sm text-red-700 dark:text-red-300">{message}</p> : null}
      {visible.length === 0 ? <p className="mt-6 text-gray-600 dark:text-gray-300">No expenses match these filters.</p> : null}
      <ul className="mt-4 space-y-3">
        {visible.map((entry) => {
          const category = workspace.categories.find((item) => item.code === entry.categoryCode);
          const claim = entry.claimId ? workspace.claims.find((item) => item.id === entry.claimId) : undefined;
          const claimHref = claim
            ? `${employeeScope ? WORKSPACE_ROUTES.expenseMyClaims : WORKSPACE_ROUTES.expenseManagementClaims}/${claim.id}`
            : null;
          return (
            <li key={entry.id} className={expenseCardClass(entry.status)}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{entry.expenseDate} · {entry.description}</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">Request {entry.requestNumber}</p>
                  {!employeeScope ? (
                    <p className="text-sm text-gray-700 dark:text-gray-300">{entry.employeeCode} · {entry.employeeName}</p>
                  ) : null}
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {category ? `${category.code} ${category.name}` : entry.categoryCode}
                  </p>
                  <p className="text-sm text-gray-800 dark:text-gray-100">
                    {formatMoney(entry.amount)} {entry.currency} · {formatMoney(entry.amountThb)} THB · {workspace.attachmentCounts[entry.id] ?? 0} attachments
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusPill status={entry.status} />
                  {claim && claimHref ? (
                    <Link href={claimHref} className="text-xs font-medium text-blue-700 dark:text-blue-300">
                      {claim.claimNumber}
                    </Link>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <Link href={detailHref(entry)} className={expenseSecondaryButtonClass}>View</Link>
                {entry.status === 'DRAFT' ? (
                  <button type="button" className={expenseSecondaryButtonClass} disabled={acting !== null} onClick={() => setPending({ id: entry.id, action: 'submit', description: entry.description })}>Submit</button>
                ) : null}
                {entry.status === 'DRAFT' || isAdmin ? (
                  <button type="button" className={expenseNeutralButtonClass} disabled={acting !== null} onClick={() => setPending({ id: entry.id, action: 'delete', description: entry.description })}>Delete</button>
                ) : null}
                {entry.status !== 'CANCELLED' && entry.status !== 'PAID' && !entry.claimId ? (
                  <button type="button" className={expenseNeutralButtonClass} disabled={acting !== null} onClick={() => setPending({ id: entry.id, action: 'cancel', description: entry.description })}>Cancel</button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {pending ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={() => { if (!acting) setPending(null); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="expense-confirm-title"
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="expense-confirm-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              {pending.action === 'submit' ? 'Submit this expense?' : pending.action === 'delete' ? (isAdmin ? 'Delete this expense?' : 'Delete this draft?') : 'Cancel this expense?'}
            </h3>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{pending.description}</p>
            {message ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">{message}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={expenseNeutralButtonClass} disabled={acting !== null} onClick={() => setPending(null)}>Back</button>
              <button type="button" className={expensePrimaryButtonClass} disabled={acting !== null} aria-busy={acting !== null} onClick={() => void confirmPending()}>
                {acting ? expenseBusyLabel(acting) : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function statusBadgeClass(status: ExpenseEntryStatus | ClaimStatus): string {
  const base = 'rounded-full border px-2 py-1 text-xs font-medium';
  if (status === 'SUBMITTED') {
    return `${base} ${SURFACE.submitted} border-sky-700 text-sky-800 dark:border-sky-300 dark:text-sky-200`;
  }
  if (status === 'PAID') {
    return `${base} ${SURFACE.paid} border-green-700 text-green-800 dark:border-green-300 dark:text-green-200`;
  }
  if (status === 'CANCELLED') {
    return `${base} ${SURFACE.cancelled} border-amber-700 text-amber-800 dark:border-amber-300 dark:text-amber-200`;
  }
  return `${base} ${SURFACE.plain} border-gray-500 text-gray-700 dark:border-gray-400 dark:text-gray-200`;
}

export function StatusPill({ status }: { status: ExpenseEntryStatus | ClaimStatus }) {
  return <span className={statusBadgeClass(status)}>{status}</span>;
}

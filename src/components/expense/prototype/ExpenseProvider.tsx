'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ExpenseEmployee, SaveExpenseInput } from '@/lib/expense/prototype/service';
import type {
  AttachmentMeta,
  ExpenseAttachmentReader,
  ExpenseCategory,
  ExpenseEntry,
  MonthlyExpenseClaim,
  StoredAttachment,
} from '@/lib/expense/prototype/types';
import type { ApiResponse } from '@/types';

type ExpenseWorkspacePayload = {
  employee: ExpenseEmployee;
  expenses: ExpenseEntry[];
  claims: MonthlyExpenseClaim[];
  categories: ExpenseCategory[];
  attachments: AttachmentMeta[];
};

type ExpenseWorkspaceValue = {
  ready: boolean;
  error: string | null;
  expenses: ExpenseEntry[];
  categories: ExpenseCategory[];
  claims: MonthlyExpenseClaim[];
  attachmentCounts: Record<string, number>;
  actingEmployeeId: string;
  refresh: () => Promise<void>;
  saveNew: (input: SaveExpenseInput) => Promise<ExpenseEntry>;
  saveDraft: (id: string, input: SaveExpenseInput) => Promise<void>;
  submit: (id: string) => Promise<void>;
  markPaid: (id: string) => Promise<void>;
  markClaimPaid: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  removeDraft: (id: string) => Promise<void>;
  removeClaim: (id: string) => Promise<void>;
  saveCategories: (rows: readonly { code: string; name: string }[]) => Promise<void>;
  generateClaim: (input: {
    employeeId: string;
    year: number;
    month: number;
    purpose: string;
    claimDate: string;
  }) => Promise<MonthlyExpenseClaim>;
  database: ExpenseAttachmentReader | null;
};

const ExpenseWorkspaceContext = createContext<ExpenseWorkspaceValue | null>(null);

async function readData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !body.success || body.data === undefined) {
    throw new Error(body.error || 'Expense request failed');
  }
  return body.data;
}

function expenseFormData(input: SaveExpenseInput): FormData {
  const form = new FormData();
  form.set('expenseDate', input.expenseDate);
  form.set('categoryCode', input.categoryCode);
  form.set('description', input.description);
  form.set('currency', input.currency);
  form.set('amount', input.amount);
  form.set('exchangeRate', input.exchangeRate);
  form.set('projectLabel', input.projectLabel);
  form.set('removeAttachmentIds', JSON.stringify(input.removeAttachmentIds));
  for (const file of input.newAttachments) {
    form.append('files', file.blob, file.fileName);
  }
  return form;
}

export function ExpenseProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [claims, setClaims] = useState<MonthlyExpenseClaim[]>([]);
  const [attachmentMetas, setAttachmentMetas] = useState<AttachmentMeta[]>([]);
  const [actingEmployeeId, setActingEmployeeId] = useState('');

  const applyPayload = (payload: ExpenseWorkspacePayload) => {
    setExpenses(payload.expenses);
    setCategories(payload.categories);
    setClaims(payload.claims);
    setAttachmentMetas(payload.attachments);
    setActingEmployeeId(payload.employee.id);
  };

  const refresh = useCallback(async () => {
    const payload = await readData<ExpenseWorkspacePayload>(await fetch('/api/expense/workspace'));
    applyPayload(payload);
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not load expenses');
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const attachmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const attachment of attachmentMetas) {
      counts[attachment.expenseId] = (counts[attachment.expenseId] ?? 0) + 1;
    }
    return counts;
  }, [attachmentMetas]);

  const database = useMemo<ExpenseAttachmentReader>(
    () => ({
      async listAttachments(expenseId) {
        return expenseId ? attachmentMetas.filter((item) => item.expenseId === expenseId) : attachmentMetas;
      },
      async getAttachment(id) {
        const meta = attachmentMetas.find((item) => item.id === id);
        if (!meta) return null;
        const response = await fetch(`/api/expense/attachments/${id}`);
        if (!response.ok) throw new Error('Could not open the attachment');
        const blob = await response.blob();
        const stored: StoredAttachment = { ...meta, blob };
        return stored;
      },
    }),
    [attachmentMetas]
  );

  const value = useMemo<ExpenseWorkspaceValue>(() => {
    return {
      ready,
      error,
      expenses,
      categories,
      claims,
      attachmentCounts,
      actingEmployeeId,
      database,
      refresh,
      async saveNew(input) {
        const created = await readData<ExpenseEntry>(
          await fetch('/api/expense/entries', { method: 'POST', body: expenseFormData(input) })
        );
        await refresh();
        return created;
      },
      async saveDraft(id, input) {
        await readData<ExpenseEntry>(
          await fetch(`/api/expense/entries/${id}`, { method: 'PATCH', body: expenseFormData(input) })
        );
        await refresh();
      },
      async submit(id) {
        await readData(await fetch(`/api/expense/entries/${id}/submit`, { method: 'POST' }));
        await refresh();
      },
      async markPaid(id) {
        await readData(await fetch(`/api/expense/entries/${id}/paid`, { method: 'POST' }));
        await refresh();
      },
      async markClaimPaid(id) {
        await readData(await fetch(`/api/expense/claims/${id}/paid`, { method: 'POST' }));
        await refresh();
      },
      async cancel(id) {
        await readData(await fetch(`/api/expense/entries/${id}/cancel`, { method: 'POST' }));
        await refresh();
      },
      async removeDraft(id) {
        await readData(await fetch(`/api/expense/entries/${id}`, { method: 'DELETE' }));
        await refresh();
      },
      async removeClaim(id) {
        await readData(await fetch(`/api/expense/claims/${id}`, { method: 'DELETE' }));
        await refresh();
      },
      async saveCategories(rows) {
        await readData(await fetch('/api/expense/categories', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows }),
        }));
        await refresh();
      },
      async generateClaim(input) {
        const claim = await readData<MonthlyExpenseClaim>(
          await fetch('/api/expense/claims', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          })
        );
        await refresh();
        return claim;
      },
    };
  }, [actingEmployeeId, attachmentCounts, categories, claims, database, error, expenses, ready, refresh]);

  return <ExpenseWorkspaceContext.Provider value={value}>{children}</ExpenseWorkspaceContext.Provider>;
}

export function useExpenseWorkspace(): ExpenseWorkspaceValue {
  const value = useContext(ExpenseWorkspaceContext);
  if (!value) throw new Error('Expense screens must be used inside the expense layout');
  return value;
}

export function PrototypeBanner(_props?: { showEmployeeSwitch?: boolean }) {
  return null;
}

export function WorkspaceStatus() {
  const { ready, error } = useExpenseWorkspace();
  if (!ready) return <p className="text-gray-700 dark:text-gray-300">Loading expenses…</p>;
  if (error) return <p className="text-red-700 dark:text-red-300">{error}</p>;
  return null;
}

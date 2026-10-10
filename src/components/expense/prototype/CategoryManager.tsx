'use client';

import { useEffect, useRef, useState } from 'react';
import { useExpenseWorkspace } from '@/components/expense/prototype/ExpenseProvider';
import { expenseBusyLabel, expenseInputClass, expenseNeutralButtonClass, expensePrimaryButtonClass, expenseSecondaryButtonClass } from '@/components/expense/prototype/fields';
import type { ExpenseCategory } from '@/lib/expense/prototype/types';

type DraftRow = {
  key: string;
  code: string;
  name: string;
  persisted: boolean;
};

function rowsFromCategories(categories: readonly ExpenseCategory[]): DraftRow[] {
  return categories.map((category) => ({
    key: category.code,
    code: category.code,
    name: category.name,
    persisted: true,
  }));
}

function savedSignature(categories: readonly ExpenseCategory[]): string {
  return categories.map((category) => `${category.code}\t${category.name}`).join('\n');
}

function draftSignature(rows: readonly DraftRow[]): string {
  return rows
    .filter((row) => row.code.trim() || row.name.trim())
    .map((row) => `${row.code.trim()}\t${row.name.trim()}`)
    .join('\n');
}

export function CategoryManager() {
  const workspace = useExpenseWorkspace();
  const stored = savedSignature(workspace.categories);
  const [rows, setRows] = useState<DraftRow[]>(() => rowsFromCategories(workspace.categories));
  const [baseline, setBaseline] = useState(stored);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingLock = useRef(false);
  const focusKey = useRef<string | null>(null);

  useEffect(() => {
    if (stored === baseline) return;
    setRows(rowsFromCategories(workspace.categories));
    setBaseline(stored);
  }, [baseline, stored, workspace.categories]);

  useEffect(() => {
    const key = focusKey.current;
    if (!key) return;
    focusKey.current = null;
    document.getElementById(`category-code-${key}`)?.focus();
  }, [rows]);

  const dirty =
    draftSignature(rows) !== stored || rows.some((row) => !row.persisted && !row.code.trim() && !row.name.trim());

  const update = (key: string, patch: Partial<Pick<DraftRow, 'code' | 'name'>>) => {
    setMessage(null);
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    const key = `new-${crypto.randomUUID()}`;
    focusKey.current = key;
    setMessage(null);
    setRows((current) => [...current, { key, code: '', name: '', persisted: false }]);
  };

  const removeRow = (key: string) => {
    const row = rows.find((item) => item.key === key);
    if (!row) return;
    if (row.persisted && workspace.expenses.some((entry) => entry.categoryCode === row.code)) {
      setMessage('This category is used by an expense');
      return;
    }
    setMessage(null);
    setRows((current) => current.filter((item) => item.key !== key));
  };

  const save = async () => {
    if (savingLock.current) return;
    savingLock.current = true;
    setMessage(null);
    setSaving(true);
    try {
      await workspace.saveCategories(rows.map((row) => ({ code: row.code, name: row.name })));
      setRows((current) => current.filter((row) => row.code.trim() || row.name.trim()));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the categories');
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Manage Category</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Codes and names stay in this browser. Edit the table, then Save once. An expense code is filled from the
            category selected on the form.
          </p>
        </div>
        <button type="submit" className={expensePrimaryButtonClass} disabled={!dirty || saving} aria-busy={saving}>
          {saving ? expenseBusyLabel('save') : 'Save'}
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{message}</p> : null}
      <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
            <tr>
              <th className="w-36 px-4 py-3 font-medium" scope="col">
                Code
              </th>
              <th className="px-4 py-3 font-medium" scope="col">
                Name
              </th>
              <th className="w-28 px-4 py-3" scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-4 py-3 align-middle">
                  <input
                    id={`category-code-${row.key}`}
                    value={row.code}
                    disabled={row.persisted || saving}
                    inputMode="numeric"
                    aria-label="Code"
                    onChange={(event) => update(row.key, { code: event.target.value })}
                    className={expenseInputClass({ disabled: row.persisted || saving })}
                  />
                </td>
                <td className="px-4 py-3 align-middle">
                  <input
                    value={row.name}
                    aria-label="Name"
                    disabled={saving}
                    onChange={(event) => update(row.key, { name: event.target.value })}
                    className={expenseInputClass({ disabled: saving })}
                  />
                </td>
                <td className="px-4 py-3 text-right align-middle">
                  <button type="button" className={expenseNeutralButtonClass} disabled={saving} onClick={() => removeRow(row.key)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className={`${expenseSecondaryButtonClass} mt-3 w-full py-3`} disabled={saving} onClick={addRow}>
        Add
      </button>
    </form>
  );
}

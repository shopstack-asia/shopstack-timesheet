'use client';

import { useMemo, useRef, useState } from 'react';
import { useExpenseWorkspace } from '@/components/expense/prototype/ExpenseProvider';
import { expenseBusyLabel, expenseInputClass, expenseNeutralButtonClass, expensePrimaryButtonClass, expenseSecondaryButtonClass } from '@/components/expense/prototype/fields';
import SearchableSelect from '@/components/SearchableSelect';
import { DateField } from '@/components/expense/prototype/pickers';
import { calculateAmountThb, formatMoney } from '@/lib/expense/prototype/money';
import { EXPENSE_CURRENCIES, type AttachmentMeta, type ExpenseCurrency, type ExpenseEntry } from '@/lib/expense/prototype/types';
import {
  normalizeAttachmentType,
  resolvedExchangeRate,
  validateAttachmentFile,
  validateExpenseDraft,
  type ExpenseDraftInput,
} from '@/lib/expense/prototype/validation';
import type { SaveExpenseInput } from '@/lib/expense/prototype/service';

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExpenseForm({
  employeeId,
  initial,
  existingAttachments = [],
  onSave,
  readOnly = false,
}: {
  employeeId: string;
  initial?: ExpenseEntry;
  existingAttachments?: AttachmentMeta[];
  onSave?: (input: SaveExpenseInput) => Promise<void>;
  readOnly?: boolean;
}) {
  const workspace = useExpenseWorkspace();
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate ?? '');
  const [categoryCode, setCategoryCode] = useState(initial?.categoryCode ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [currency, setCurrency] = useState<ExpenseCurrency>(initial?.currency ?? 'THB');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [exchangeRate, setExchangeRate] = useState(initial?.exchangeRate ?? '1.00');
  const [projectLabel, setProjectLabel] = useState(initial?.projectLabel ?? '');
  const [kept, setKept] = useState(existingAttachments);
  const [removed, setRemoved] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const savingLock = useRef(false);

  const amountThb = useMemo(() => {
    try {
      return calculateAmountThb(amount, resolvedExchangeRate(currency, exchangeRate));
    } catch {
      return null;
    }
  }, [amount, currency, exchangeRate]);

  const addFiles = (list: FileList | File[]) => {
    const next = [...files];
    const messages: string[] = [];
    for (const file of Array.from(list)) {
      const message = validateAttachmentFile(file);
      if (message) {
        messages.push(message);
        continue;
      }
      next.push(file);
    }
    if (kept.length + next.length > 8) {
      messages.push('At most 8 attachments');
    } else {
      setFiles(next);
    }
    setFormError(messages[0] ?? null);
  };

  const previewSaved = async (id: string) => {
    const stored = await workspace.database?.getAttachment(id);
    if (!stored) return;
    const url = URL.createObjectURL(stored.blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const submit = async () => {
    if (readOnly || !onSave || savingLock.current) return;
    const input: ExpenseDraftInput = {
      expenseDate,
      categoryCode,
      description,
      currency,
      amount,
      exchangeRate,
      projectLabel,
      attachmentCount: kept.length + files.length,
    };
    const errors = validateExpenseDraft(input, workspace.categories);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    savingLock.current = true;
    setSaving(true);
    setFormError(null);
    try {
      await onSave({
        ...input,
        employeeId,
        removeAttachmentIds: removed,
        newAttachments: files.map((file) => ({
          fileName: file.name,
          mimeType: normalizeAttachmentType(file.type),
          size: file.size,
          blob: file,
        })),
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save the expense');
      savingLock.current = false;
      setSaving(false);
    }
  };

  return (
    <form
      className="max-w-3xl space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label="Expense date" error={fieldErrors.expenseDate}>
        <div className={readOnly ? 'pointer-events-none' : undefined} onKeyDownCapture={readOnly ? (event) => event.preventDefault() : undefined}>
          <DateField value={expenseDate} onChange={setExpenseDate} invalid={Boolean(fieldErrors.expenseDate)} />
        </div>
      </Field>
      <Field label="Expense category" error={fieldErrors.categoryCode}>
        <div className={readOnly ? 'pointer-events-none' : undefined} onKeyDownCapture={readOnly ? (event) => event.preventDefault() : undefined}>
        <SearchableSelect
          required={!readOnly}
          value={categoryCode}
          onChange={setCategoryCode}
          placeholder="Select a category"
          error={Boolean(fieldErrors.categoryCode)}
          options={workspace.categories.map((category) => ({
            value: category.code,
            label: `${category.code} — ${category.name}`,
          }))}
        />
        </div>
      </Field>
      <Field label="Expense code">
        <input readOnly value={workspace.categories.find((category) => category.code === categoryCode)?.code ?? ''} className={expenseInputClass({ disabled: true })} />
      </Field>
      <Field label="Explanation" error={fieldErrors.description}>
        <textarea value={description} readOnly={readOnly} onChange={(event) => setDescription(event.target.value)} className={expenseInputClass({ invalid: Boolean(fieldErrors.description) })} rows={3} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Currency" error={fieldErrors.currency}>
          <div className={readOnly ? 'pointer-events-none' : undefined} onKeyDownCapture={readOnly ? (event) => event.preventDefault() : undefined}>
          <SearchableSelect
            value={currency}
            error={Boolean(fieldErrors.currency)}
            onChange={(next) => {
              const code = next as ExpenseCurrency;
              setCurrency(code);
              setExchangeRate(code === 'THB' ? '1.00' : '');
            }}
            options={EXPENSE_CURRENCIES.map((code) => ({ value: code, label: code }))}
          />
          </div>
        </Field>
        <Field label="Amount" error={fieldErrors.amount}>
          <input value={amount} readOnly={readOnly} onChange={(event) => setAmount(event.target.value)} className={expenseInputClass({ invalid: Boolean(fieldErrors.amount) })} inputMode="decimal" />
        </Field>
        <Field label="Exchange rate" error={fieldErrors.exchangeRate}>
          <input
            value={currency === 'THB' ? '1.00' : exchangeRate}
            readOnly={readOnly}
            disabled={currency === 'THB'}
            onChange={(event) => setExchangeRate(event.target.value)}
            className={expenseInputClass({ disabled: currency === 'THB', invalid: Boolean(fieldErrors.exchangeRate) })}
            inputMode="decimal"
          />
        </Field>
        <Field label="Amount (THB)">
          <input readOnly value={amountThb ? formatMoney(amountThb) : ''} className={expenseInputClass({ disabled: true })} />
        </Field>
      </div>
      <Field label="Project / work context (optional)">
        <input value={projectLabel} readOnly={readOnly} onChange={(event) => setProjectLabel(event.target.value)} className={expenseInputClass()} />
      </Field>
      <div
        className="rounded-lg border border-dashed border-gray-300 bg-white p-4 dark:border-gray-600 dark:bg-gray-800"
        onDragOver={(event) => {
          if (readOnly) return;
          event.preventDefault();
        }}
        onDrop={(event) => {
          if (readOnly) return;
          event.preventDefault();
          addFiles(event.dataTransfer.files);
        }}
      >
        {readOnly ? null : (
          <>
            <p className="text-sm text-gray-700 dark:text-gray-300">Drop PDF, JPG, or PNG files here, or choose files.</p>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              multiple
              className="mt-2 block w-full text-sm text-gray-700 file:mr-3 file:rounded file:border file:border-blue-200 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100 dark:text-gray-300 dark:file:border-blue-800 dark:file:bg-blue-900/30 dark:file:text-blue-300"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </>
        )}
        <ul className={`space-y-2 ${readOnly ? '' : 'mt-3'}`}>
          {kept.map((attachment) => (
            <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {attachment.fileName} · {attachment.mimeType} · {formatBytes(attachment.size)} · Saved locally
              </span>
              <span className="flex gap-3">
                <button type="button" className={expenseSecondaryButtonClass} onClick={() => void previewSaved(attachment.id)}>
                  Preview
                </button>
                {readOnly ? null : (
                  <button
                    type="button"
                    className={expenseNeutralButtonClass}
                    onClick={() => {
                      setKept((current) => current.filter((item) => item.id !== attachment.id));
                      setRemoved((current) => [...current, attachment.id]);
                    }}
                  >
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {file.name} · {normalizeAttachmentType(file.type)} · {formatBytes(file.size)} · Ready to save
              </span>
              <span className="flex gap-3">
                <button
                  type="button"
                  className={expenseSecondaryButtonClass}
                  onClick={() => {
                    const url = URL.createObjectURL(file);
                    window.open(url, '_blank', 'noopener,noreferrer');
                    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
                  }}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className={expenseNeutralButtonClass}
                  onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
        {readOnly && kept.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-300">No attachments.</p> : null}
        {fieldErrors.attachments ? <p className="mt-2 text-sm text-red-700">{fieldErrors.attachments}</p> : null}
      </div>
      {formError ? <p className="text-sm text-red-700 dark:text-red-300">{formError}</p> : null}
      {readOnly ? null : (
        <button type="submit" disabled={saving} aria-busy={saving} className={expensePrimaryButtonClass}>
          {saving ? expenseBusyLabel('save') : 'Save draft'}
        </button>
      )}
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block text-sm text-gray-700 dark:text-gray-300">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span> : null}
    </div>
  );
}

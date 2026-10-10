import { getDemoEmployee } from '@/lib/expense/prototype/employees';
import { EXPENSE_CATEGORIES } from '@/lib/expense/prototype/categories';
import { addThb, calculateAmountThb } from '@/lib/expense/prototype/money';
import type {
  ClaimStatus,
  ExpenseCategory,
  ExpenseDatabase,
  ExpenseEntry,
  ExpenseEntryStatus,
  MonthlyExpenseClaim,
  StoredAttachment,
} from '@/lib/expense/prototype/types';
import {
  normalizeAttachmentType,
  resolvedExchangeRate,
  validateAttachmentFile,
  validateExpenseDraft,
  type ExpenseDraftInput,
} from '@/lib/expense/prototype/validation';

export type NewAttachment = {
  fileName: string;
  mimeType: string;
  size: number;
  blob: Blob;
};

export type ExpenseEmployee = {
  id: string;
  code: string;
  name: string;
  businessUnit: string;
};

export type SaveExpenseInput = ExpenseDraftInput & {
  employeeId: string;
  newAttachments: NewAttachment[];
  removeAttachmentIds: string[];
};

function resolveEmployee(employeeId: string, employee?: ExpenseEmployee): ExpenseEmployee {
  const resolved = employee ?? getDemoEmployee(employeeId);
  if (!resolved || resolved.id !== employeeId) throw new Error('Unknown employee');
  return resolved;
}

function nowIso(): string {
  return new Date().toISOString();
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function expenseInMonth(date: string, year: number, month: number): boolean {
  return date.startsWith(monthKey(year, month));
}

/** Next folder name from rows already stored. A deleted row is invisible here. */
export function nextRequestNumber(existing: readonly { requestNumber: string }[], year: number): string {
  const prefix = `EXP-${year}-`;
  const highest = existing.reduce((max, item) => {
    if (!item.requestNumber.startsWith(prefix)) return max;
    const sequence = Number(item.requestNumber.slice(prefix.length));
    return Number.isInteger(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(6, '0')}`;
}

/** Issues EXP-YYYY-NNNNNN once. Deleting the expense does not hand the number out again. */
export async function allocateRequestNumber(db: ExpenseDatabase, year: number): Promise<string> {
  const key = `expense-request-seq-${year}`;
  const fromRows = Number(nextRequestNumber(await db.listExpenses(), year).slice(`EXP-${year}-`.length));
  const stored = Number((await db.getMeta(key)) ?? '0');
  const sequence = Math.max(fromRows, (Number.isInteger(stored) ? stored : 0) + 1);
  await db.setMeta(key, String(sequence));
  return `EXP-${year}-${String(sequence).padStart(6, '0')}`;
}

export function nextClaimNumber(
  claims: readonly MonthlyExpenseClaim[],
  year: number,
  month: number
): string {
  const prefix = `EXP-${year}-${String(month).padStart(2, '0')}-`;
  const sequence = claims.filter((claim) => claim.claimNumber.startsWith(prefix)).length + 1;
  return `${prefix}${String(sequence).padStart(4, '0')}`;
}

async function replaceAttachments(
  db: ExpenseDatabase,
  expenseId: string,
  removeAttachmentIds: string[],
  newAttachments: NewAttachment[]
): Promise<void> {
  const existing = await db.listAttachments(expenseId);
  const remaining = existing.filter((item) => !removeAttachmentIds.includes(item.id));
  if (remaining.length + newAttachments.length > 8) {
    throw new Error('At most 8 attachments');
  }
  for (const file of newAttachments) {
    const message = validateAttachmentFile({
      name: file.fileName,
      type: file.mimeType,
      size: file.size,
    });
    if (message) throw new Error(message);
  }
  for (const id of removeAttachmentIds) {
    await db.deleteAttachment(id);
  }
  for (const file of newAttachments) {
    const attachment: StoredAttachment = {
      id: crypto.randomUUID(),
      expenseId,
      fileName: file.fileName,
      mimeType: normalizeAttachmentType(file.mimeType),
      size: file.size,
      blob: file.blob,
    };
    await db.saveAttachment(attachment);
  }
}

function buildEntry(
  existing: ExpenseEntry | null,
  input: SaveExpenseInput,
  categories: readonly ExpenseCategory[],
  employee?: ExpenseEmployee
): ExpenseEntry {
  const errors = validateExpenseDraft(
    {
      ...input,
      attachmentCount: input.attachmentCount,
    },
    categories
  );
  if (Object.keys(errors).length > 0) {
    throw new Error(Object.values(errors)[0] || 'Expense is invalid');
  }
  if (existing && existing.employeeId !== input.employeeId) throw new Error('Unknown employee');
  const owner = existing
    ? {
        id: existing.employeeId,
        code: existing.employeeCode,
        name: existing.employeeName,
        businessUnit: existing.businessUnit,
      }
    : resolveEmployee(input.employeeId, employee);
  const currency = input.currency as ExpenseEntry['currency'];
  const exchangeRate = resolvedExchangeRate(currency, input.exchangeRate);
  const timestamp = nowIso();
  return {
    id: existing?.id ?? crypto.randomUUID(),
    employeeId: owner.id,
    employeeCode: owner.code,
    employeeName: owner.name,
    businessUnit: owner.businessUnit,
    expenseDate: input.expenseDate,
    categoryCode: input.categoryCode,
    description: input.description.trim(),
    currency,
    amount: input.amount.trim(),
    exchangeRate,
    amountThb: calculateAmountThb(input.amount, exchangeRate),
    projectLabel: input.projectLabel.trim(),
    status: existing?.status ?? 'DRAFT',
    claimId: existing?.claimId ?? null,
    requestNumber: existing?.requestNumber ?? '',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

export async function createExpense(
  db: ExpenseDatabase,
  input: SaveExpenseInput,
  employee?: ExpenseEmployee
): Promise<ExpenseEntry> {
  const entry = buildEntry(
    null,
    {
      ...input,
      attachmentCount: input.newAttachments.length,
    },
    await listCategories(db),
    employee
  );
  const year = Number(entry.expenseDate.slice(0, 4));
  entry.requestNumber = await allocateRequestNumber(db, year);
  await db.saveExpense(entry);
  await replaceAttachments(db, entry.id, [], input.newAttachments);
  return entry;
}

export async function updateDraftExpense(
  db: ExpenseDatabase,
  expenseId: string,
  input: SaveExpenseInput,
  employee?: ExpenseEmployee
): Promise<ExpenseEntry> {
  const current = (await db.listExpenses()).find((entry) => entry.id === expenseId);
  if (!current) throw new Error('Expense not found');
  if (current.status !== 'DRAFT') throw new Error('Only draft expenses can be edited');
  const existingAttachments = await db.listAttachments(expenseId);
  const attachmentCount =
    existingAttachments.filter((item) => !input.removeAttachmentIds.includes(item.id)).length +
    input.newAttachments.length;
  const entry = buildEntry(current, { ...input, attachmentCount }, await listCategories(db), employee);
  await db.saveExpense(entry);
  await replaceAttachments(db, entry.id, input.removeAttachmentIds, input.newAttachments);
  return entry;
}

export async function deleteExpenseRecord(
  db: ExpenseDatabase,
  expenseId: string,
  options?: { anyStatus?: boolean }
): Promise<void> {
  const current = (await db.listExpenses()).find((entry) => entry.id === expenseId);
  if (!current) throw new Error('Expense not found');
  if (!options?.anyStatus && current.status !== 'DRAFT') throw new Error('Only draft expenses can be deleted');
  const attachments = await db.listAttachments(expenseId);
  for (const attachment of attachments) {
    await db.deleteAttachment(attachment.id);
  }
  await db.deleteExpense(expenseId);
}

export function deleteDraftExpense(db: ExpenseDatabase, expenseId: string): Promise<void> {
  return deleteExpenseRecord(db, expenseId);
}

async function setStatus(
  db: ExpenseDatabase,
  expenseId: string,
  status: ExpenseEntryStatus
): Promise<ExpenseEntry> {
  const current = (await db.listExpenses()).find((entry) => entry.id === expenseId);
  if (!current) throw new Error('Expense not found');
  if (current.status === 'PAID' && status !== 'PAID') {
    throw new Error('Paid expenses cannot be cancelled');
  }
  if (status === 'PAID') {
    if (current.status !== 'SUBMITTED') throw new Error('Only submitted expenses can be marked paid');
  } else if (current.claimId) {
    throw new Error('This expense is already included in a monthly claim');
  }
  if (status === 'SUBMITTED' && current.status !== 'DRAFT') {
    throw new Error('Only draft expenses can be submitted');
  }
  if (status === 'CANCELLED' && current.status === 'CANCELLED') {
    throw new Error('Expense is already cancelled');
  }
  if (status === 'CANCELLED' && current.status === 'DRAFT') {
    // drafts may be cancelled or deleted; cancellation keeps the record
  }
  const next: ExpenseEntry = {
    ...current,
    status,
    updatedAt: nowIso(),
  };
  await db.saveExpense(next);
  return next;
}

export function submitExpense(db: ExpenseDatabase, expenseId: string): Promise<ExpenseEntry> {
  return setStatus(db, expenseId, 'SUBMITTED');
}

export function cancelExpense(db: ExpenseDatabase, expenseId: string): Promise<ExpenseEntry> {
  return setStatus(db, expenseId, 'CANCELLED');
}

export function resolveClaimStatus(
  claim: Pick<MonthlyExpenseClaim, 'id' | 'expenseIds'>,
  expenses: readonly ExpenseEntry[]
): ClaimStatus {
  const linked = expenses.filter((entry) => entry.claimId === claim.id);
  const rows = linked.length > 0 ? linked : expenses.filter((entry) => claim.expenseIds.includes(entry.id));
  if (rows.length > 0 && rows.every((entry) => entry.status === 'PAID')) return 'PAID';
  return 'PROCESSING';
}

export async function markExpensePaid(db: ExpenseDatabase, expenseId: string): Promise<ExpenseEntry> {
  const paid = await setStatus(db, expenseId, 'PAID');
  if (paid.claimId) await syncClaimStatus(db, paid.claimId);
  return paid;
}

export async function markClaimPaid(db: ExpenseDatabase, claimId: string): Promise<MonthlyExpenseClaim> {
  const claim = (await db.listClaims()).find((item) => item.id === claimId);
  if (!claim) throw new Error('Claim not found');
  const expenses = await db.listExpenses();
  if (resolveClaimStatus(claim, expenses) === 'PAID') throw new Error('This claim is already paid');
  const included = expenses.filter((entry) => entry.claimId === claim.id || claim.expenseIds.includes(entry.id));
  for (const entry of included) {
    if (entry.status === 'SUBMITTED') await markExpensePaid(db, entry.id);
  }
  const updated = (await db.listClaims()).find((item) => item.id === claimId);
  if (!updated || updated.status !== 'PAID') throw new Error('Could not mark the claim paid');
  return updated;
}

/** Removes the claim document. Expenses stay, with the claim link cleared, in whatever status they had. */
export async function deleteMonthlyClaim(db: ExpenseDatabase, claimId: string): Promise<void> {
  const claim = (await db.listClaims()).find((item) => item.id === claimId);
  if (!claim) throw new Error('Claim not found');
  const expenses = await db.listExpenses();
  for (const entry of expenses) {
    if (entry.claimId !== claimId) continue;
    await db.saveExpense({ ...entry, claimId: null, updatedAt: nowIso() });
  }
  await db.deleteClaim(claimId);
}

async function syncClaimStatus(db: ExpenseDatabase, claimId: string): Promise<void> {
  const claim = (await db.listClaims()).find((item) => item.id === claimId);
  if (!claim) return;
  const status = resolveClaimStatus(claim, await db.listExpenses());
  if (claim.status === status) return;
  await db.saveClaim({ ...claim, status });
}

export type EligibleClaimGroup = {
  employeeId: string;
  employeeName: string;
  businessUnit: string;
  entries: ExpenseEntry[];
  totalThb: string;
};

/** Submitted expenses that are not on a claim, grouped by employee for the selected month. */
export function groupEligibleClaimExpenses(
  expenses: readonly ExpenseEntry[],
  year: number,
  month: number
): EligibleClaimGroup[] {
  const groups = new Map<string, EligibleClaimGroup>();
  const waiting = expenses
    .filter((entry) => entry.status === 'SUBMITTED' && !entry.claimId && expenseInMonth(entry.expenseDate, year, month))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.expenseDate.localeCompare(b.expenseDate) || a.id.localeCompare(b.id));
  for (const entry of waiting) {
    const current = groups.get(entry.employeeId);
    if (!current) {
      groups.set(entry.employeeId, {
        employeeId: entry.employeeId,
        employeeName: entry.employeeName,
        businessUnit: entry.businessUnit,
        entries: [entry],
        totalThb: entry.amountThb,
      });
      continue;
    }
    current.entries.push(entry);
    current.totalThb = addThb(current.totalThb, entry.amountThb);
  }
  return [...groups.values()];
}

export function eligibleClaimExpenses(
  expenses: readonly ExpenseEntry[],
  employeeId: string,
  year: number,
  month: number
): ExpenseEntry[] {
  return expenses
    .filter(
      (entry) =>
        entry.employeeId === employeeId &&
        entry.status === 'SUBMITTED' &&
        !entry.claimId &&
        expenseInMonth(entry.expenseDate, year, month)
    )
    .sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || a.id.localeCompare(b.id));
}

export async function createMonthlyClaim(
  db: ExpenseDatabase,
  input: {
    employeeId: string;
    year: number;
    month: number;
    purpose: string;
    claimDate: string;
  },
  employee?: ExpenseEmployee
): Promise<MonthlyExpenseClaim> {
  const resolved = resolveEmployee(input.employeeId, employee);
  if (!input.purpose.trim()) throw new Error('Enter a purpose');
  const expenses = await db.listExpenses();
  const included = eligibleClaimExpenses(expenses, input.employeeId, input.year, input.month);
  if (included.length === 0) {
    throw new Error('No submitted expenses are available for this employee and month');
  }
  const claims = await db.listClaims();
  const claim: MonthlyExpenseClaim = {
    id: crypto.randomUUID(),
    claimNumber: nextClaimNumber(claims, input.year, input.month),
    employeeId: resolved.id,
    employeeCode: resolved.code,
    employeeName: resolved.name,
    businessUnit: resolved.businessUnit,
    year: input.year,
    month: input.month,
    purpose: input.purpose.trim(),
    claimDate: input.claimDate,
    expenseIds: included.map((entry) => entry.id),
    totalThb: included.reduce((sum, entry) => addThb(sum, entry.amountThb), '0.00'),
    status: 'PROCESSING',
    createdAt: nowIso(),
  };
  await db.saveClaim(claim);
  for (const entry of included) {
    await db.saveExpense({ ...entry, claimId: claim.id, updatedAt: claim.createdAt });
  }
  return claim;
}

export async function listCategories(db: ExpenseDatabase): Promise<ExpenseCategory[]> {
  const raw = await db.getMeta('categories');
  if (!raw) return [...EXPENSE_CATEGORIES];
  try {
    const parsed = JSON.parse(raw) as ExpenseCategory[];
    if (!Array.isArray(parsed)) return [...EXPENSE_CATEGORIES];
    return [...parsed].sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true }));
  } catch {
    return [...EXPENSE_CATEGORIES];
  }
}

/** Replaces the stored category list in one write. Blank rows are ignored. A missing code is a delete. */
export function replaceCategories(
  current: readonly ExpenseCategory[],
  rows: readonly { code: string; name: string }[],
  usedCodes: ReadonlySet<string>
): ExpenseCategory[] {
  const next: ExpenseCategory[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const code = row.code.trim();
    const name = row.name.trim();
    if (!code && !name) continue;
    if (!/^\d{3,6}$/.test(code)) throw new Error('Category code must be 3 to 6 digits');
    if (!name) throw new Error('Enter a category name');
    if (seen.has(code)) throw new Error(`Category code ${code} is duplicated`);
    seen.add(code);
    next.push({ code, name });
  }
  for (const category of current) {
    if (!seen.has(category.code) && usedCodes.has(category.code)) {
      throw new Error('This category is used by an expense');
    }
  }
  return [...next].sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true }));
}

export async function saveCategories(
  db: ExpenseDatabase,
  rows: readonly { code: string; name: string }[]
): Promise<void> {
  const current = await listCategories(db);
  const usedCodes = new Set((await db.listExpenses()).map((entry) => entry.categoryCode));
  const next = replaceCategories(current, rows, usedCodes);
  await db.setMeta('categories', JSON.stringify(next));
}

export async function saveCategory(
  db: ExpenseDatabase,
  input: { code: string; name: string }
): Promise<void> {
  const current = await listCategories(db);
  const code = input.code.trim();
  const next = current.some((category) => category.code === code)
    ? current.map((category) => (category.code === code ? { code, name: input.name } : category))
    : [...current, { code, name: input.name }];
  await saveCategories(db, next);
}

export async function deleteCategory(db: ExpenseDatabase, code: string): Promise<void> {
  const next = (await listCategories(db)).filter((category) => category.code !== code);
  await saveCategories(db, next);
}

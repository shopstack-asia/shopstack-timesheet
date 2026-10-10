import { PDFDocument } from 'pdf-lib';
import { renderClaimFormPdf, type ClaimFormInput, type ClaimFormRow } from '@/lib/expense/pdf/claim-form';
import { renderFullPackagePdf, type PackageGroup } from '@/lib/expense/pdf/package';
import type { ExpenseAttachmentReader, ExpenseCategory, ExpenseEntry, MonthlyExpenseClaim } from '@/lib/expense/prototype/types';

export function claimFormInput(
  claim: MonthlyExpenseClaim,
  expenses: readonly ExpenseEntry[],
  categories: readonly ExpenseCategory[]
): ClaimFormInput {
  const rows: ClaimFormRow[] = claim.expenseIds.map((id) => {
    const entry = expenses.find((item) => item.id === id);
    if (!entry) throw new Error(`Expense ${id} is missing`);
    const category = categories.find((item) => item.code === entry.categoryCode);
    return {
      date: entry.expenseDate,
      expense: category?.name ?? entry.categoryCode,
      code: entry.categoryCode,
      explanation: entry.description,
      currency: entry.currency,
      amount: entry.amount,
      exchangeRate: entry.exchangeRate,
      amountThb: entry.amountThb,
    };
  });
  return {
    claimNumber: claim.claimNumber,
    employeeName: claim.employeeName,
    businessUnit: claim.businessUnit,
    purpose: claim.purpose,
    claimDate: claim.claimDate,
    rows,
    totalThb: claim.totalThb,
  };
}

function pdfBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: 'application/pdf' });
}

export function downloadPdf(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(pdfBlob(bytes));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function printPdf(bytes: Uint8Array) {
  const url = URL.createObjectURL(pdfBlob(bytes));
  const frame = document.createElement('iframe');
  frame.setAttribute('title', 'Expense claim PDF');
  frame.style.position = 'fixed';
  frame.style.left = '-10000px';
  frame.style.top = '0';
  frame.style.width = '800px';
  frame.style.height = '1000px';
  frame.style.border = '0';
  frame.src = url;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  document.body.appendChild(frame);
}

export async function downloadClaimPackage(
  claim: MonthlyExpenseClaim,
  expenses: readonly ExpenseEntry[],
  categories: readonly ExpenseCategory[],
  database: ExpenseAttachmentReader | null
) {
  if (!database) throw new Error('Storage is not ready');
  downloadPdf(await claimPackagePdf(claim, expenses, categories, database), `${claim.claimNumber}.pdf`);
}

export async function printClaimPackage(
  claim: MonthlyExpenseClaim,
  expenses: readonly ExpenseEntry[],
  categories: readonly ExpenseCategory[],
  database: ExpenseAttachmentReader | null
) {
  if (!database) throw new Error('Storage is not ready');
  printPdf(await claimPackagePdf(claim, expenses, categories, database));
}

async function combinedClaimPackages(
  claims: readonly MonthlyExpenseClaim[],
  expenses: readonly ExpenseEntry[],
  categories: readonly ExpenseCategory[],
  database: ExpenseAttachmentReader | null
): Promise<Uint8Array> {
  if (!database) throw new Error('Storage is not ready');
  if (claims.length === 0) throw new Error('Select a claim');
  const parts: Uint8Array[] = [];
  for (const claim of claims) {
    parts.push(await claimPackagePdf(claim, expenses, categories, database));
  }
  if (parts.length === 1) return parts[0];
  const output = await PDFDocument.create();
  for (const part of parts) {
    const source = await PDFDocument.load(part);
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }
  return output.save();
}

export async function downloadClaimPackages(
  claims: readonly MonthlyExpenseClaim[],
  expenses: readonly ExpenseEntry[],
  categories: readonly ExpenseCategory[],
  database: ExpenseAttachmentReader | null
) {
  const bytes = await combinedClaimPackages(claims, expenses, categories, database);
  const fileName = claims.length === 1 ? `${claims[0].claimNumber}.pdf` : 'expense-claims.pdf';
  downloadPdf(bytes, fileName);
}

export async function printClaimPackages(
  claims: readonly MonthlyExpenseClaim[],
  expenses: readonly ExpenseEntry[],
  categories: readonly ExpenseCategory[],
  database: ExpenseAttachmentReader | null
) {
  printPdf(await combinedClaimPackages(claims, expenses, categories, database));
}

export async function claimPackagePdf(
  claim: MonthlyExpenseClaim,
  expenses: readonly ExpenseEntry[],
  categories: readonly ExpenseCategory[],
  database: ExpenseAttachmentReader
): Promise<Uint8Array> {
  const form = await renderClaimFormPdf(claimFormInput(claim, expenses, categories));
  const groups: PackageGroup[] = [];
  for (const [index, expenseId] of claim.expenseIds.entries()) {
    const entry = expenses.find((item) => item.id === expenseId);
    if (!entry) throw new Error(`Expense ${expenseId} is missing`);
    const metas = await database.listAttachments(expenseId);
    const attachments = [];
    for (const meta of metas) {
      const stored = await database.getAttachment(meta.id);
      if (!stored) throw new Error(`Missing attachment: ${meta.fileName}`);
      attachments.push({
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        bytes: new Uint8Array(await stored.blob.arrayBuffer()),
      });
    }
    if (attachments.length > 0) {
      groups.push({
        index: index + 1,
        date: entry.expenseDate,
        category: categories.find((item) => item.code === entry.categoryCode)?.name ?? entry.categoryCode,
        description: entry.description,
        attachments,
      });
    }
  }
  return renderFullPackagePdf({
    formPdf: form,
    header: {
      claimNumber: claim.claimNumber,
      employeeName: claim.employeeName,
      businessUnit: claim.businessUnit,
      purpose: claim.purpose,
      claimDate: claim.claimDate,
    },
    groups,
  });
}

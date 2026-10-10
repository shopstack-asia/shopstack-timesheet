import { EXPENSE_CATEGORIES } from '@/lib/expense/prototype/categories';
import type { ExpenseCategory } from '@/lib/expense/prototype/types';
import {
  calculateAmountThb,
  isExpenseCurrency,
} from '@/lib/expense/prototype/money';
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_EXPENSE,
  type ExpenseCurrency,
} from '@/lib/expense/prototype/types';

export type ExpenseDraftInput = {
  expenseDate: string;
  categoryCode: string;
  description: string;
  currency: string;
  amount: string;
  exchangeRate: string;
  projectLabel: string;
  attachmentCount: number;
};

export type FieldErrors = Partial<Record<keyof ExpenseDraftInput | 'attachments', string>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateExpenseDraft(
  input: ExpenseDraftInput,
  categories: readonly ExpenseCategory[] = EXPENSE_CATEGORIES
): FieldErrors {
  const errors: FieldErrors = {};
  if (!DATE_PATTERN.test(input.expenseDate) || Number.isNaN(Date.parse(input.expenseDate))) {
    errors.expenseDate = 'Enter a valid expense date';
  }
  if (!categories.some((category) => category.code === input.categoryCode)) {
    errors.categoryCode = 'Select an expense category';
  }
  if (!input.description.trim()) {
    errors.description = 'Enter an explanation';
  }
  if (!isExpenseCurrency(input.currency)) {
    errors.currency = 'Select a currency';
  }
  if (input.attachmentCount > MAX_ATTACHMENTS_PER_EXPENSE) {
    errors.attachments = `At most ${MAX_ATTACHMENTS_PER_EXPENSE} attachments`;
  }

  const currency = input.currency;
  const rate = currency === 'THB' ? '1.00' : input.exchangeRate;
  if (currency !== 'THB' && !input.exchangeRate.trim()) {
    errors.exchangeRate = 'Enter an exchange rate';
  }

  if (!errors.currency && !errors.exchangeRate) {
    try {
      calculateAmountThb(input.amount, rate);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid amount';
      if (message.toLowerCase().includes('exchange')) {
        errors.exchangeRate = message;
      } else {
        errors.amount = message;
      }
    }
  }

  return errors;
}

export function resolvedExchangeRate(currency: ExpenseCurrency, exchangeRate: string): string {
  return currency === 'THB' ? '1.00' : exchangeRate.trim();
}

export function validateAttachmentFile(file: { name: string; type: string; size: number }): string | null {
  const type = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(type)) {
    return `${file.name} must be a PDF, JPG, or PNG`;
  }
  if (file.size <= 0) {
    return `${file.name} is empty`;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name} is larger than 8 MB`;
  }
  return null;
}

export function normalizeAttachmentType(type: string): string {
  return type === 'image/jpg' ? 'image/jpeg' : type;
}

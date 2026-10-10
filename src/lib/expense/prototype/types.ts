export const EXPENSE_CURRENCIES = ['THB', 'USD', 'EUR', 'SGD', 'JPY'] as const;

export type ExpenseCurrency = (typeof EXPENSE_CURRENCIES)[number];

export type ExpenseEntryStatus = 'DRAFT' | 'SUBMITTED' | 'PAID' | 'CANCELLED';

export type ClaimStatus = 'PROCESSING' | 'PAID';

export type DemoEmployee = {
  id: string;
  code: string;
  name: string;
  businessUnit: string;
};

export type ExpenseCategory = {
  code: string;
  name: string;
};

export type ExpenseEntry = {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  businessUnit: string;
  expenseDate: string;
  categoryCode: string;
  description: string;
  currency: ExpenseCurrency;
  amount: string;
  exchangeRate: string;
  amountThb: string;
  projectLabel: string;
  requestNumber: string;
  status: ExpenseEntryStatus;
  claimId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AttachmentMeta = {
  id: string;
  expenseId: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export type StoredAttachment = AttachmentMeta & {
  blob: Blob;
};

export type MonthlyExpenseClaim = {
  id: string;
  claimNumber: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  businessUnit: string;
  year: number;
  month: number;
  purpose: string;
  claimDate: string;
  expenseIds: string[];
  totalThb: string;
  status: ClaimStatus;
  createdAt: string;
};

export type ExpenseAttachmentReader = {
  listAttachments(expenseId?: string): Promise<AttachmentMeta[]>;
  getAttachment(id: string): Promise<StoredAttachment | null>;
};

export type ExpenseDatabase = {
  listExpenses(): Promise<ExpenseEntry[]>;
  saveExpense(entry: ExpenseEntry): Promise<void>;
  deleteExpense(id: string): Promise<void>;
  listAttachments(expenseId?: string): Promise<AttachmentMeta[]>;
  getAttachment(id: string): Promise<StoredAttachment | null>;
  saveAttachment(attachment: StoredAttachment): Promise<void>;
  deleteAttachment(id: string): Promise<void>;
  listClaims(): Promise<MonthlyExpenseClaim[]>;
  saveClaim(claim: MonthlyExpenseClaim): Promise<void>;
  deleteClaim(id: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  clearAll(): Promise<void>;
};

export const ALLOWED_ATTACHMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_EXPENSE = 8;

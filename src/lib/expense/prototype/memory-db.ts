import type {
  AttachmentMeta,
  ExpenseDatabase,
  ExpenseEntry,
  MonthlyExpenseClaim,
  StoredAttachment,
} from '@/lib/expense/prototype/types';

export function createMemoryExpenseDatabase(): ExpenseDatabase {
  const expenses = new Map<string, ExpenseEntry>();
  const attachments = new Map<string, StoredAttachment>();
  const claims = new Map<string, MonthlyExpenseClaim>();
  const meta = new Map<string, string>();

  return {
    async listExpenses() {
      return [...expenses.values()];
    },
    async saveExpense(entry) {
      expenses.set(entry.id, entry);
    },
    async deleteExpense(id) {
      expenses.delete(id);
    },
    async listAttachments(expenseId) {
      const rows = [...attachments.values()];
      const filtered = expenseId ? rows.filter((row) => row.expenseId === expenseId) : rows;
      return filtered.map(toMeta);
    },
    async getAttachment(id) {
      return attachments.get(id) ?? null;
    },
    async saveAttachment(attachment) {
      attachments.set(attachment.id, attachment);
    },
    async deleteAttachment(id) {
      attachments.delete(id);
    },
    async listClaims() {
      return [...claims.values()];
    },
    async saveClaim(claim) {
      claims.set(claim.id, claim);
    },
    async deleteClaim(id) {
      claims.delete(id);
    },
    async getMeta(key) {
      return meta.get(key) ?? null;
    },
    async setMeta(key, value) {
      meta.set(key, value);
    },
    async clearAll() {
      expenses.clear();
      attachments.clear();
      claims.clear();
      meta.clear();
    },
  };
}

function toMeta(attachment: StoredAttachment): AttachmentMeta {
  return {
    id: attachment.id,
    expenseId: attachment.expenseId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
  };
}

import type {
  AttachmentMeta,
  ExpenseDatabase,
  ExpenseEntry,
  MonthlyExpenseClaim,
  StoredAttachment,
} from '@/lib/expense/prototype/types';

const DB_NAME = 'shopstack-expense-prototype';
const DB_VERSION = 1;

type MetaRow = { key: string; value: string };

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('expenses')) {
        db.createObjectStore('expenses', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('attachments')) {
        const store = db.createObjectStore('attachments', { keyPath: 'id' });
        store.createIndex('expenseId', 'expenseId', { unique: false });
      }
      if (!db.objectStoreNames.contains('claims')) {
        db.createObjectStore('claims', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAll<T>(storeName: string): Promise<T[]> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readonly');
  const rows = await requestToPromise(transaction.objectStore(storeName).getAll() as IDBRequest<T[]>);
  await transactionDone(transaction);
  return rows;
}

export function createIndexedDbExpenseDatabase(): ExpenseDatabase {
  return {
    listExpenses: () => readAll<ExpenseEntry>('expenses'),
    async saveExpense(entry) {
      const db = await openDatabase();
      const transaction = db.transaction('expenses', 'readwrite');
      transaction.objectStore('expenses').put(entry);
      await transactionDone(transaction);
    },
    async deleteExpense(id) {
      const db = await openDatabase();
      const transaction = db.transaction('expenses', 'readwrite');
      transaction.objectStore('expenses').delete(id);
      await transactionDone(transaction);
    },
    async listAttachments(expenseId) {
      const rows = await readAll<StoredAttachment>('attachments');
      const filtered = expenseId ? rows.filter((row) => row.expenseId === expenseId) : rows;
      return filtered.map(toMeta);
    },
    async getAttachment(id) {
      const db = await openDatabase();
      const transaction = db.transaction('attachments', 'readonly');
      const row = await requestToPromise(
        transaction.objectStore('attachments').get(id) as IDBRequest<StoredAttachment | undefined>
      );
      await transactionDone(transaction);
      return row ?? null;
    },
    async saveAttachment(attachment) {
      const db = await openDatabase();
      const transaction = db.transaction('attachments', 'readwrite');
      transaction.objectStore('attachments').put(attachment);
      await transactionDone(transaction);
    },
    async deleteAttachment(id) {
      const db = await openDatabase();
      const transaction = db.transaction('attachments', 'readwrite');
      transaction.objectStore('attachments').delete(id);
      await transactionDone(transaction);
    },
    listClaims: () => readAll<MonthlyExpenseClaim>('claims'),
    async saveClaim(claim) {
      const db = await openDatabase();
      const transaction = db.transaction('claims', 'readwrite');
      transaction.objectStore('claims').put(claim);
      await transactionDone(transaction);
    },
    async deleteClaim(id) {
      const db = await openDatabase();
      const transaction = db.transaction('claims', 'readwrite');
      transaction.objectStore('claims').delete(id);
      await transactionDone(transaction);
    },
    async getMeta(key) {
      const db = await openDatabase();
      const transaction = db.transaction('meta', 'readonly');
      const row = await requestToPromise(
        transaction.objectStore('meta').get(key) as IDBRequest<MetaRow | undefined>
      );
      await transactionDone(transaction);
      return row?.value ?? null;
    },
    async setMeta(key, value) {
      const db = await openDatabase();
      const transaction = db.transaction('meta', 'readwrite');
      transaction.objectStore('meta').put({ key, value } satisfies MetaRow);
      await transactionDone(transaction);
    },
    async clearAll() {
      const db = await openDatabase();
      const transaction = db.transaction(['expenses', 'attachments', 'claims', 'meta'], 'readwrite');
      transaction.objectStore('expenses').clear();
      transaction.objectStore('attachments').clear();
      transaction.objectStore('claims').clear();
      transaction.objectStore('meta').clear();
      await transactionDone(transaction);
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

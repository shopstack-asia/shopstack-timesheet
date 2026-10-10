import type { Client } from 'pg';
import { readExpenseDriveConfig } from '@/lib/expense/drive/config';
import {
  deleteExpenseFile,
  deleteExpenseFolder,
  deleteExpenseUpload,
  ensureExpenseFolder,
  uploadExpenseFile,
} from '@/lib/expense/drive/folders';
import type {
  AttachmentMeta,
  ExpenseCategory,
  ExpenseDatabase,
  ExpenseEntry,
  MonthlyExpenseClaim,
  StoredAttachment,
} from '@/lib/expense/prototype/types';

type Queryable = Pick<Client, 'query'>;

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

export function mapExpenseRow(row: Record<string, unknown>): ExpenseEntry {
  return {
    id: text(row.id),
    employeeId: text(row.employee_id),
    employeeCode: text(row.employee_code),
    employeeName: text(row.employee_name),
    businessUnit: text(row.business_unit),
    expenseDate: text(row.expense_date),
    categoryCode: text(row.category_code),
    description: text(row.description),
    currency: text(row.currency) as ExpenseEntry['currency'],
    amount: text(row.amount),
    exchangeRate: text(row.exchange_rate),
    amountThb: text(row.amount_thb),
    projectLabel: text(row.project_label),
    requestNumber: text(row.request_number),
    status: text(row.status) as ExpenseEntry['status'],
    claimId: row.claim_id == null ? null : text(row.claim_id),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export function mapClaimRow(row: Record<string, unknown>, expenseIds: string[]): MonthlyExpenseClaim {
  return {
    id: text(row.id),
    claimNumber: text(row.claim_number),
    employeeId: text(row.employee_id),
    employeeCode: text(row.employee_code),
    employeeName: text(row.employee_name),
    businessUnit: text(row.business_unit),
    year: Number(row.year),
    month: Number(row.month),
    purpose: text(row.purpose),
    claimDate: text(row.claim_date),
    expenseIds,
    totalThb: text(row.total_thb),
    status: text(row.status) as MonthlyExpenseClaim['status'],
    createdAt: timestamp(row.created_at),
  };
}

function mapAttachmentMeta(row: Record<string, unknown>): AttachmentMeta {
  return {
    id: text(row.id),
    expenseId: text(row.expense_id),
    fileName: text(row.file_name),
    mimeType: text(row.mime_type),
    size: Number(row.size_bytes),
  };
}

export function createPostgresExpenseDatabase(client: Queryable): ExpenseDatabase {
  return {
    async listExpenses() {
      const result = await client.query(
        `SELECT id, employee_id, employee_code, employee_name, business_unit, expense_date,
                category_code, description, currency, amount, exchange_rate, amount_thb,
                project_label, request_number, status, claim_id, created_at, updated_at
         FROM expense_entries
         ORDER BY expense_date, created_at, id`
      );
      return result.rows.map((row) => mapExpenseRow(row as Record<string, unknown>));
    },
    async saveExpense(entry) {
      if (readExpenseDriveConfig().implemented) await ensureExpenseFolder(entry.requestNumber);
      await client.query(
        `INSERT INTO expense_entries (
           id, employee_id, employee_code, employee_name, business_unit, expense_date,
           category_code, description, currency, amount, exchange_rate, amount_thb,
           project_label, request_number, status, claim_id, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
         )
         ON CONFLICT (id) DO UPDATE SET
           expense_date = EXCLUDED.expense_date,
           category_code = EXCLUDED.category_code,
           description = EXCLUDED.description,
           currency = EXCLUDED.currency,
           amount = EXCLUDED.amount,
           exchange_rate = EXCLUDED.exchange_rate,
           amount_thb = EXCLUDED.amount_thb,
           project_label = EXCLUDED.project_label,
           status = EXCLUDED.status,
           claim_id = EXCLUDED.claim_id,
           updated_at = EXCLUDED.updated_at`,
        [
          entry.id,
          entry.employeeId,
          entry.employeeCode,
          entry.employeeName,
          entry.businessUnit,
          entry.expenseDate,
          entry.categoryCode,
          entry.description,
          entry.currency,
          entry.amount,
          entry.exchangeRate,
          entry.amountThb,
          entry.projectLabel,
          entry.requestNumber,
          entry.status,
          entry.claimId,
          entry.createdAt,
          entry.updatedAt,
        ]
      );
    },
    async deleteExpense(id) {
      const existing = await client.query('SELECT request_number FROM expense_entries WHERE id = $1', [id]);
      const requestNumber = text((existing.rows[0] as Record<string, unknown> | undefined)?.request_number);
      if (requestNumber) await deleteExpenseFolder(requestNumber);
      await client.query('DELETE FROM expense_entries WHERE id = $1', [id]);
    },
    async listAttachments(expenseId) {
      const result = expenseId
        ? await client.query(
            `SELECT id, expense_id, file_name, mime_type, size_bytes
             FROM expense_attachments WHERE expense_id = $1 ORDER BY file_name, id`,
            [expenseId]
          )
        : await client.query(
            `SELECT id, expense_id, file_name, mime_type, size_bytes
             FROM expense_attachments ORDER BY file_name, id`
          );
      return result.rows.map((row) => mapAttachmentMeta(row as Record<string, unknown>));
    },
    async getAttachment(id) {
      const result = await client.query(
        `SELECT id, expense_id, file_name, mime_type, size_bytes, content
         FROM expense_attachments WHERE id = $1`,
        [id]
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      const content = row.content;
      const bytes = Buffer.isBuffer(content) ? new Uint8Array(content) : new Uint8Array();
      const meta = mapAttachmentMeta(row);
      const stored: StoredAttachment = {
        ...meta,
        blob: new Blob([bytes], { type: meta.mimeType }),
      };
      return stored;
    },
    async saveAttachment(attachment) {
      const bytes = Buffer.from(await attachment.blob.arrayBuffer());
      const existing = await client.query('SELECT drive_file_id FROM expense_attachments WHERE id = $1', [attachment.id]);
      let driveFileId = text((existing.rows[0] as Record<string, unknown> | undefined)?.drive_file_id);
      if (!driveFileId && readExpenseDriveConfig().implemented) {
        const expense = await client.query('SELECT request_number FROM expense_entries WHERE id = $1', [attachment.expenseId]);
        const requestNumber = text((expense.rows[0] as Record<string, unknown> | undefined)?.request_number);
        driveFileId = await uploadExpenseFile({
          requestNumber,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          bytes,
        });
      }
      await client.query(
        `INSERT INTO expense_attachments (id, expense_id, file_name, mime_type, size_bytes, content, drive_file_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           file_name = EXCLUDED.file_name,
           mime_type = EXCLUDED.mime_type,
           size_bytes = EXCLUDED.size_bytes,
           content = EXCLUDED.content,
           drive_file_id = EXCLUDED.drive_file_id`,
        [attachment.id, attachment.expenseId, attachment.fileName, attachment.mimeType, attachment.size, bytes, driveFileId || null]
      );
    },
    async deleteAttachment(id) {
      const existing = await client.query(
        `SELECT attachment.drive_file_id, attachment.file_name, entry.request_number
         FROM expense_attachments AS attachment
         LEFT JOIN expense_entries AS entry ON entry.id = attachment.expense_id
         WHERE attachment.id = $1`,
        [id]
      );
      const row = existing.rows[0] as Record<string, unknown> | undefined;
      const driveFileId = text(row?.drive_file_id);
      const fileName = text(row?.file_name);
      const requestNumber = text(row?.request_number);
      if (requestNumber && fileName) {
        await deleteExpenseUpload({ requestNumber, fileName, fileId: driveFileId });
      } else if (driveFileId) {
        await deleteExpenseFile(driveFileId);
      }
      await client.query('DELETE FROM expense_attachments WHERE id = $1', [id]);
    },
    async listClaims() {
      const claims = await client.query(
        `SELECT id, claim_number, employee_id, employee_code, employee_name, business_unit,
                year, month, purpose, claim_date, total_thb, status, created_at
         FROM expense_claims
         ORDER BY claim_number`
      );
      const links = await client.query(
        `SELECT id, claim_id FROM expense_entries WHERE claim_id IS NOT NULL ORDER BY expense_date, id`
      );
      return claims.rows.map((row) => {
        const record = row as Record<string, unknown>;
        const expenseIds = links.rows
          .filter((link) => text((link as Record<string, unknown>).claim_id) === text(record.id))
          .map((link) => text((link as Record<string, unknown>).id));
        return mapClaimRow(record, expenseIds);
      });
    },
    async saveClaim(claim) {
      await client.query(
        `INSERT INTO expense_claims (
           id, claim_number, employee_id, employee_code, employee_name, business_unit,
           year, month, purpose, claim_date, total_thb, status, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           purpose = EXCLUDED.purpose,
           claim_date = EXCLUDED.claim_date,
           total_thb = EXCLUDED.total_thb,
           status = EXCLUDED.status`,
        [
          claim.id,
          claim.claimNumber,
          claim.employeeId,
          claim.employeeCode,
          claim.employeeName,
          claim.businessUnit,
          claim.year,
          claim.month,
          claim.purpose,
          claim.claimDate,
          claim.totalThb,
          claim.status,
          claim.createdAt,
        ]
      );
    },
    async deleteClaim(id) {
      await client.query('DELETE FROM expense_claims WHERE id = $1', [id]);
    },
    async getMeta(key) {
      if (key !== 'categories') {
        const result = await client.query('SELECT value FROM expense_meta WHERE key = $1', [key]);
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return row ? text(row.value) : null;
      }
      const result = await client.query('SELECT code, name FROM expense_categories ORDER BY code');
      const categories: ExpenseCategory[] = result.rows.map((row) => {
        const record = row as Record<string, unknown>;
        return { code: text(record.code), name: text(record.name) };
      });
      return JSON.stringify(categories);
    },
    async setMeta(key, value) {
      if (key !== 'categories') {
        await client.query(
          `INSERT INTO expense_meta (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, value]
        );
        return;
      }
      const next = JSON.parse(value) as ExpenseCategory[];
      if (next.length === 0) {
        await client.query('DELETE FROM expense_categories');
        return;
      }
      for (const category of next) {
        await client.query(
          `INSERT INTO expense_categories (code, name) VALUES ($1, $2)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
          [category.code, category.name]
        );
      }
      await client.query('DELETE FROM expense_categories WHERE NOT (code = ANY($1::text[]))', [
        next.map((category) => category.code),
      ]);
    },
    async clearAll() {
      await client.query('DELETE FROM expense_attachments');
      await client.query('UPDATE expense_entries SET claim_id = NULL');
      await client.query('DELETE FROM expense_entries');
      await client.query('DELETE FROM expense_claims');
    },
  };
}

export async function withExpenseDatabase<T>(fn: (db: ExpenseDatabase) => Promise<T>): Promise<T> {
  const url = process.env.EXPENSE_DATABASE_URL?.trim();
  if (!url) throw new Error('EXPENSE_DATABASE_URL is not configured');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(createPostgresExpenseDatabase(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection may already be closed.
    }
    throw error;
  } finally {
    await client.end();
  }
}

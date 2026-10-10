import {
  EXPENSE_MIGRATION_LEDGER_SQL,
  EXPENSE_MIGRATION_LOCK_KEY,
  EXPENSE_MIGRATIONS,
  type ExpenseMigration,
} from '@/lib/expense/db/migrations';

export type MigrationQueryResult = {
  rows: Array<Record<string, unknown>>;
};

export type MigrationSession = {
  query(sql: string, params?: unknown[]): Promise<MigrationQueryResult>;
  end(): Promise<void>;
};

export function assertMigrationList(migrations: readonly ExpenseMigration[]): void {
  const seen = new Set<string>();
  for (const migration of migrations) {
    const id = migration.id.trim();
    if (!id) {
      throw new Error('Expense migration id is empty');
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate expense migration id: ${id}`);
    }
    if (!migration.sql.trim()) {
      throw new Error(`Expense migration ${id} has empty SQL`);
    }
    seen.add(id);
  }
}

/**
 * Apply pending SQL migrations on an open Postgres session.
 * Each migration runs in its own transaction. A failure rolls that migration back
 * and leaves earlier migrations committed.
 */
export async function applyExpenseMigrations(
  client: Pick<MigrationSession, 'query'>,
  migrations: readonly ExpenseMigration[] = EXPENSE_MIGRATIONS
): Promise<string[]> {
  assertMigrationList(migrations);
  await client.query('SELECT pg_advisory_lock($1)', [EXPENSE_MIGRATION_LOCK_KEY]);
  try {
    await client.query(EXPENSE_MIGRATION_LEDGER_SQL);
    const existing = await client.query('SELECT id FROM expense_schema_migrations');
    const applied = new Set(
      existing.rows.map((row) => String(row.id ?? '')).filter((id) => id.length > 0)
    );
    const newlyApplied: string[] = [];

    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO expense_schema_migrations (id) VALUES ($1)', [
          migration.id,
        ]);
        await client.query('COMMIT');
        newlyApplied.push(migration.id);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return newlyApplied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [EXPENSE_MIGRATION_LOCK_KEY]);
  }
}

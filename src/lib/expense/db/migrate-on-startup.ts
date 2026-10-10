import { applyExpenseMigrations, type MigrationSession } from '@/lib/expense/db/migrate';
import { EXPENSE_MIGRATIONS, type ExpenseMigration } from '@/lib/expense/db/migrations';

export const EXPENSE_DATABASE_URL_ENV = 'EXPENSE_DATABASE_URL';

export type ExpenseMigrationStartupResult =
  | { skipped: true }
  | { skipped: false; applied: string[] };

async function connectWithPg(url: string): Promise<MigrationSession> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  return {
    query: async (sql, params) => {
      const result = await client.query(sql, params as never[] | undefined);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
    end: () => client.end(),
  };
}

/**
 * Run expense SQL migrations when Postgres is configured.
 * Unset EXPENSE_DATABASE_URL skips the connection so Timesheet startup is unchanged.
 * A configured database that fails to migrate stops the server.
 */
export async function migrateExpenseDatabaseOnStartup(
  env: Record<string, string | undefined> = process.env,
  deps?: {
    connect?: (url: string) => Promise<MigrationSession>;
    migrations?: readonly ExpenseMigration[];
  }
): Promise<ExpenseMigrationStartupResult> {
  const url = env[EXPENSE_DATABASE_URL_ENV]?.trim();
  if (!url) {
    return { skipped: true };
  }

  const connect = deps?.connect ?? connectWithPg;
  const session = await connect(url);
  try {
    const applied = await applyExpenseMigrations(session, deps?.migrations ?? EXPENSE_MIGRATIONS);
    if (applied.length > 0) {
      console.info(`[startup] Expense database migrations applied: ${applied.join(', ')}`);
    }
    return { skipped: false, applied };
  } finally {
    await session.end();
  }
}

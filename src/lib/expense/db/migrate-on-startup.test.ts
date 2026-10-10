import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { applyExpenseMigrations } from '@/lib/expense/db/migrate';
import { migrateExpenseDatabaseOnStartup } from '@/lib/expense/db/migrate-on-startup';
import type { MigrationSession } from '@/lib/expense/db/migrate';

function memorySession(options?: { failSql?: string }): MigrationSession & { applied: string[] } {
  const applied: string[] = [];
  let openTransaction = false;
  const pendingInserts: string[] = [];

  return {
    applied,
    async query(sql, params) {
      if (sql === 'BEGIN') {
        openTransaction = true;
        pendingInserts.length = 0;
        return { rows: [] };
      }
      if (sql === 'ROLLBACK') {
        openTransaction = false;
        pendingInserts.length = 0;
        return { rows: [] };
      }
      if (sql === 'COMMIT') {
        openTransaction = false;
        applied.push(...pendingInserts);
        pendingInserts.length = 0;
        return { rows: [] };
      }
      if (sql === 'SELECT id FROM expense_schema_migrations') {
        return { rows: applied.map((id) => ({ id })) };
      }
      if (sql === 'INSERT INTO expense_schema_migrations (id) VALUES ($1)') {
        pendingInserts.push(String(params?.[0]));
        return { rows: [] };
      }
      if (options?.failSql && sql === options.failSql) {
        throw new Error('migration sql failed');
      }
      return { rows: [] };
    },
    async end() {
      return undefined;
    },
  };
}

describe('applyExpenseMigrations', () => {
  it('creates the ledger and applies pending migrations in order', async () => {
    const session = memorySession();
    const applied = await applyExpenseMigrations(session, [
      { id: '0001_a', sql: 'SELECT 1' },
      { id: '0002_b', sql: 'SELECT 2' },
    ]);
    expect(applied).toEqual(['0001_a', '0002_b']);
    expect(session.applied).toEqual(['0001_a', '0002_b']);
  });

  it('skips migrations that are already recorded', async () => {
    const session = memorySession();
    await applyExpenseMigrations(session, [{ id: '0001_a', sql: 'SELECT 1' }]);
    const second = await applyExpenseMigrations(session, [
      { id: '0001_a', sql: 'SELECT 1' },
      { id: '0002_b', sql: 'SELECT 2' },
    ]);
    expect(second).toEqual(['0002_b']);
    expect(session.applied).toEqual(['0001_a', '0002_b']);
  });

  it('rolls back a failed migration and does not record it', async () => {
    const session = memorySession({ failSql: 'SELECT bad' });
    await expect(
      applyExpenseMigrations(session, [
        { id: '0001_a', sql: 'SELECT 1' },
        { id: '0002_b', sql: 'SELECT bad' },
      ])
    ).rejects.toThrow('migration sql failed');
    expect(session.applied).toEqual(['0001_a']);
  });

  it('rejects a duplicate migration id before running SQL', async () => {
    const session = memorySession();
    await expect(
      applyExpenseMigrations(session, [
        { id: '0001_a', sql: 'SELECT 1' },
        { id: '0001_a', sql: 'SELECT 2' },
      ])
    ).rejects.toThrow('Duplicate expense migration id: 0001_a');
    expect(session.applied).toEqual([]);
  });
});

describe('migrateExpenseDatabaseOnStartup', () => {
  it('does not connect when EXPENSE_DATABASE_URL is unset', async () => {
    const connect = vi.fn();
    const result = await migrateExpenseDatabaseOnStartup({}, { connect });
    expect(result).toEqual({ skipped: true });
    expect(connect).not.toHaveBeenCalled();
  });

  it('migrates and closes the session when the URL is set', async () => {
    const session = memorySession();
    const end = vi.spyOn(session, 'end');
    const result = await migrateExpenseDatabaseOnStartup(
      { EXPENSE_DATABASE_URL: 'postgres://expense@localhost/expense' },
      {
        connect: async () => session,
        migrations: [{ id: '0001_a', sql: 'SELECT 1' }],
      }
    );
    expect(result).toEqual({ skipped: false, applied: ['0001_a'] });
    expect(end).toHaveBeenCalledOnce();
  });

  it('closes the session and throws when migration fails', async () => {
    const session = memorySession({ failSql: 'SELECT bad' });
    const end = vi.spyOn(session, 'end');
    await expect(
      migrateExpenseDatabaseOnStartup(
        { EXPENSE_DATABASE_URL: 'postgres://expense@localhost/expense' },
        {
          connect: async () => session,
          migrations: [{ id: '0001_a', sql: 'SELECT bad' }],
        }
      )
    ).rejects.toThrow('migration sql failed');
    expect(end).toHaveBeenCalledOnce();
    expect(session.applied).toEqual([]);
  });

  it('is invoked from server startup', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/instrumentation.ts'),
      'utf8'
    );
    expect(source).toContain('migrateExpenseDatabaseOnStartup');
  });
});

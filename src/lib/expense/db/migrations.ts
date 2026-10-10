import { EXPENSE_CATEGORIES } from '@/lib/expense/prototype/categories';

export type ExpenseMigration = {
  id: string;
  sql: string;
};

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const categorySeed = EXPENSE_CATEGORIES.map(
  (category) => `  (${sqlText(category.code)}, ${sqlText(category.name)})`
).join(',\n');

/**
 * Ordered expense schema changes. The runner applies each id once.
 * Attachment bytes stay in Postgres until Google Drive upload exists.
 */
export const EXPENSE_MIGRATIONS: readonly ExpenseMigration[] = [
  {
    id: '001_expense_ledger',
    sql: `
CREATE TABLE expense_categories (
  code text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE expense_claims (
  id text PRIMARY KEY,
  claim_number text NOT NULL UNIQUE,
  employee_id text NOT NULL,
  employee_code text NOT NULL,
  employee_name text NOT NULL,
  business_unit text NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL,
  purpose text NOT NULL,
  claim_date text NOT NULL,
  total_thb text NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSING', 'PAID')),
  created_at timestamptz NOT NULL
);

CREATE TABLE expense_entries (
  id text PRIMARY KEY,
  employee_id text NOT NULL,
  employee_code text NOT NULL,
  employee_name text NOT NULL,
  business_unit text NOT NULL,
  expense_date text NOT NULL,
  category_code text NOT NULL REFERENCES expense_categories (code),
  description text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('THB', 'USD', 'EUR', 'SGD', 'JPY')),
  amount text NOT NULL,
  exchange_rate text NOT NULL,
  amount_thb text NOT NULL,
  project_label text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'PAID', 'CANCELLED')),
  claim_id text REFERENCES expense_claims (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX expense_entries_employee_idx ON expense_entries (employee_id);
CREATE INDEX expense_entries_claim_idx ON expense_entries (claim_id);

CREATE TABLE expense_attachments (
  id text PRIMARY KEY,
  expense_id text NOT NULL REFERENCES expense_entries (id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  content bytea NOT NULL
);

INSERT INTO expense_categories (code, name) VALUES
${categorySeed};
`.trim(),
  },
  {
    id: '002_expense_request_numbers',
    sql: `
ALTER TABLE expense_entries ADD COLUMN request_number text;

UPDATE expense_entries AS entry
SET request_number = numbered.request_number
FROM (
  SELECT id,
         'EXP-' || substring(expense_date from 1 for 4) || '-' ||
         lpad(
           row_number() OVER (
             PARTITION BY substring(expense_date from 1 for 4)
             ORDER BY created_at, id
           )::text,
           6,
           '0'
         ) AS request_number
  FROM expense_entries
) AS numbered
WHERE entry.id = numbered.id
  AND entry.request_number IS NULL;

ALTER TABLE expense_entries ALTER COLUMN request_number SET NOT NULL;
CREATE UNIQUE INDEX expense_entries_request_number_key ON expense_entries (request_number);

ALTER TABLE expense_attachments ADD COLUMN drive_file_id text;

CREATE TABLE expense_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);
`.trim(),
  },
  {
    id: '003_workspace_role_members',
    sql: `
CREATE TABLE workspace_role_members (
  role text NOT NULL CHECK (role IN ('ADMIN', 'HR')),
  employee_code text NOT NULL,
  PRIMARY KEY (role, employee_code)
);

INSERT INTO workspace_role_members (role, employee_code) VALUES ('ADMIN', 'S0005');
`.trim(),
  },
];

export const EXPENSE_MIGRATION_LOCK_KEY = 748201;

export const EXPENSE_MIGRATION_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS expense_schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)
`.trim();

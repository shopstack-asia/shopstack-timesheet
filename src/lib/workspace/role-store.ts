import type { Client } from 'pg';
import {
  ASSIGNABLE_WORKSPACE_ROLES,
  emptyRoleAssignments,
  parseEmployeeCodes,
  rolesForEmployee,
  WORKSPACE_ROLE_LABELS,
  type AssignableWorkspaceRole,
  type WorkspaceRoleAssignment,
} from '@/lib/workspace/roles';

export async function isAdministrator(employeeId: string): Promise<boolean> {
  try {
    const assignments = await listRoleAssignments();
    return rolesForEmployee(employeeId, assignments).includes('ADMIN');
  } catch {
    return false;
  }
}

async function withRoleClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = process.env.EXPENSE_DATABASE_URL?.trim();
  if (!url) throw new Error('EXPENSE_DATABASE_URL is not configured');
  const { Client: PgClient } = await import('pg');
  const client = new PgClient({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
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

export async function listRoleAssignments(): Promise<WorkspaceRoleAssignment[]> {
  return withRoleClient(async (client) => {
    const result = await client.query<{ role: string; employee_code: string }>(
      `SELECT role, employee_code
       FROM workspace_role_members
       ORDER BY employee_code`
    );
    return emptyRoleAssignments().map((assignment) => ({
      ...assignment,
      employeeCodes: result.rows
        .filter((row) => row.role === assignment.role)
        .map((row) => row.employee_code),
    }));
  });
}

export async function replaceRoleMembers(
  role: AssignableWorkspaceRole,
  employeeCodes: readonly string[]
): Promise<WorkspaceRoleAssignment> {
  if (!(ASSIGNABLE_WORKSPACE_ROLES as readonly string[]).includes(role)) {
    throw new Error('Role is invalid');
  }
  const codes = parseEmployeeCodes(employeeCodes);
  return withRoleClient(async (client) => {
    await client.query('DELETE FROM workspace_role_members WHERE role = $1', [role]);
    for (const code of codes) {
      await client.query(
        'INSERT INTO workspace_role_members (role, employee_code) VALUES ($1, $2)',
        [role, code]
      );
    }
    return {
      role,
      label: WORKSPACE_ROLE_LABELS[role],
      employeeCodes: codes,
    };
  });
}

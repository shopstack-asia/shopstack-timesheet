export const ASSIGNABLE_WORKSPACE_ROLES = ['ADMIN', 'HR'] as const;

export type AssignableWorkspaceRole = (typeof ASSIGNABLE_WORKSPACE_ROLES)[number];

export type WorkspaceRoleAssignment = {
  role: AssignableWorkspaceRole;
  label: string;
  employeeCodes: string[];
};

export const WORKSPACE_ROLE_LABELS: Record<AssignableWorkspaceRole, string> = {
  ADMIN: 'Administrator',
  HR: 'HR & Financial',
};

/** Seeded once by migration 003. Later edits can remove this code. */
export const DEFAULT_ADMINISTRATOR_CODE = 'S0005';

const EMPLOYEE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,31}$/;

export function isAssignableWorkspaceRole(value: string): value is AssignableWorkspaceRole {
  return (ASSIGNABLE_WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function normalizeEmployeeCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Trims, uppercases, and rejects an empty or malformed employee code. Duplicates in one list are ignored. */
export function parseEmployeeCodes(values: readonly string[]): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const code = normalizeEmployeeCode(value);
    if (!code) continue;
    if (!EMPLOYEE_CODE_PATTERN.test(code)) {
      throw new Error('Employee code is invalid');
    }
    if (seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

export function emptyRoleAssignments(): WorkspaceRoleAssignment[] {
  return ASSIGNABLE_WORKSPACE_ROLES.map((role) => ({
    role,
    label: WORKSPACE_ROLE_LABELS[role],
    employeeCodes: [],
  }));
}

export function rolesForEmployee(
  employeeId: string | undefined,
  assignments: readonly Pick<WorkspaceRoleAssignment, 'role' | 'employeeCodes'>[]
): Array<'EMPLOYEE' | AssignableWorkspaceRole> {
  const code = normalizeEmployeeCode(employeeId ?? '');
  const roles: Array<'EMPLOYEE' | AssignableWorkspaceRole> = ['EMPLOYEE'];
  if (!code) return roles;
  for (const role of ASSIGNABLE_WORKSPACE_ROLES) {
    const assignment = assignments.find((item) => item.role === role);
    if (assignment?.employeeCodes.some((item) => normalizeEmployeeCode(item) === code)) {
      roles.push(role);
    }
  }
  return roles;
}

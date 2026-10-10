import type { StaffProfile } from '@/types';
import { rolesForEmployee, type WorkspaceRoleAssignment } from '@/lib/workspace/roles';

export type WorkspaceRole = 'EMPLOYEE' | 'HR' | 'ADMIN';

export const EXPENSE_MANAGEMENT_ROLES: readonly WorkspaceRole[] = ['HR', 'ADMIN'];

/**
 * Zoho People staff profiles expose Position (job title) and Email.
 * Neither field is an authorization role. HR and ADMIN come only from
 * workspace role assignments. A profile with no matching code stays EMPLOYEE.
 */
export function resolveWorkspaceRoles(
  profile: StaffProfile | undefined,
  assignments: readonly Pick<WorkspaceRoleAssignment, 'role' | 'employeeCodes'>[] = []
): WorkspaceRole[] {
  return rolesForEmployee(profile?.EmployeeID, assignments);
}

export function hasWorkspaceRole(
  roles: readonly WorkspaceRole[],
  allowed: readonly WorkspaceRole[]
): boolean {
  return allowed.some((role) => roles.includes(role));
}

export function canAccessExpenseManagement(
  roles: readonly WorkspaceRole[]
): boolean {
  return hasWorkspaceRole(roles, EXPENSE_MANAGEMENT_ROLES);
}

export type AuthorizationDecision =
  | { allowed: true; roles: WorkspaceRole[] }
  | {
      allowed: false;
      status: 401 | 403;
      error: string;
      roles: WorkspaceRole[];
    };

export function authorizeExpenseManagement(
  session: { staffProfile?: StaffProfile } | null | undefined,
  assignments: readonly Pick<WorkspaceRoleAssignment, 'role' | 'employeeCodes'>[] = []
): AuthorizationDecision {
  if (!session) {
    return {
      allowed: false,
      status: 401,
      error: 'Authentication required',
      roles: [],
    };
  }

  const roles = resolveWorkspaceRoles(session.staffProfile, assignments);
  if (!canAccessExpenseManagement(roles)) {
    return {
      allowed: false,
      status: 403,
      error: 'Expense Management requires HR or Admin authorization',
      roles,
    };
  }

  return { allowed: true, roles };
}

import {
  canAccessExpenseManagement,
  hasWorkspaceRole,
  type WorkspaceRole,
} from '@/lib/workspace/authorization';

/** Settings is Admin only. Expense Management is HR & Financial or Administrator. */
export function canOpenWorkspacePath(pathname: string, roles: readonly WorkspaceRole[]): boolean {
  if (pathname === '/settings' || pathname.startsWith('/settings/')) {
    return hasWorkspaceRole(roles, ['ADMIN']);
  }
  if (pathname === '/expense/management' || pathname.startsWith('/expense/management/')) {
    return canAccessExpenseManagement(roles);
  }
  return true;
}

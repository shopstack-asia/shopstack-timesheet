import { getServerSession } from 'next-auth';
import { ExpenseAccessDenied } from '@/components/expense/ExpenseAccessDenied';
import { authOptions } from '@/lib/auth';
import { canAccessExpenseManagement, resolveWorkspaceRoles } from '@/lib/workspace/authorization';
import { listRoleAssignments } from '@/lib/workspace/role-store';
import type { WorkspaceRoleAssignment } from '@/lib/workspace/roles';

export default async function ExpenseManagementLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  let assignments: WorkspaceRoleAssignment[] = [];
  try {
    assignments = await listRoleAssignments();
  } catch {
    assignments = [];
  }
  const roles = resolveWorkspaceRoles(session?.staffProfile, assignments);
  if (!canAccessExpenseManagement(roles)) return <ExpenseAccessDenied />;
  return children;
}

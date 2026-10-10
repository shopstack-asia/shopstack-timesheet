import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasWorkspaceRole, resolveWorkspaceRoles } from '@/lib/workspace/authorization';
import { listRoleAssignments } from '@/lib/workspace/role-store';
import type { WorkspaceRoleAssignment } from '@/lib/workspace/roles';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  let assignments: WorkspaceRoleAssignment[] = [];
  try {
    assignments = await listRoleAssignments();
  } catch {
    assignments = [];
  }
  const roles = resolveWorkspaceRoles(session?.staffProfile, assignments);
  if (!hasWorkspaceRole(roles, ['ADMIN'])) {
    return (
      <div className="container mx-auto px-4 py-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h2>
        <p className="mt-3 max-w-2xl text-gray-700 dark:text-gray-300">
          You do not have access to Settings. This area is limited to Administrator.
        </p>
        <a
          href={WORKSPACE_ROUTES.timesheet}
          className="mt-6 inline-block text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-300"
        >
          Back to My Timesheet
        </a>
      </div>
    );
  }
  return children;
}

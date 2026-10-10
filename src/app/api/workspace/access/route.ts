import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resolveWorkspaceRoles } from '@/lib/workspace/authorization';
import { listRoleAssignments } from '@/lib/workspace/role-store';
import type { WorkspaceRoleAssignment } from '@/lib/workspace/roles';
import type { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.staffProfile) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  let assignments: WorkspaceRoleAssignment[] = [];
  try {
    assignments = await listRoleAssignments();
  } catch {
    assignments = [];
  }
  const roles = resolveWorkspaceRoles(session.staffProfile, assignments);
  return NextResponse.json<ApiResponse<{ roles: typeof roles }>>({
    success: true,
    data: { roles },
  });
}

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasWorkspaceRole, resolveWorkspaceRoles } from '@/lib/workspace/authorization';
import { listRoleAssignments, replaceRoleMembers } from '@/lib/workspace/role-store';
import { isAssignableWorkspaceRole, type WorkspaceRoleAssignment } from '@/lib/workspace/roles';
import type { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

async function requireAdministrator(): Promise<
  { assignments: WorkspaceRoleAssignment[] } | { response: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session?.staffProfile) {
    return { response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  }
  let assignments: WorkspaceRoleAssignment[];
  try {
    assignments = await listRoleAssignments();
  } catch (error) {
    const message =
      error instanceof Error && !('code' in error) ? error.message : 'Could not load roles';
    const status = message === 'EXPENSE_DATABASE_URL is not configured' ? 503 : 500;
    return { response: NextResponse.json({ success: false, error: message }, { status }) };
  }
  const roles = resolveWorkspaceRoles(session.staffProfile, assignments);
  if (!hasWorkspaceRole(roles, ['ADMIN'])) {
    return {
      response: NextResponse.json(
        { success: false, error: 'Settings requires Administrator authorization' },
        { status: 403 }
      ),
    };
  }
  return { assignments };
}

export async function GET() {
  const access = await requireAdministrator();
  if ('response' in access) return access.response;
  return NextResponse.json<ApiResponse<{ assignments: WorkspaceRoleAssignment[] }>>({
    success: true,
    data: { assignments: access.assignments },
  });
}

export async function PUT(request: Request) {
  const access = await requireAdministrator();
  if ('response' in access) return access.response;
  let body: { role?: unknown; employeeCodes?: unknown };
  try {
    body = (await request.json()) as { role?: unknown; employeeCodes?: unknown };
  } catch {
    return NextResponse.json({ success: false, error: 'Role is invalid' }, { status: 400 });
  }
  if (typeof body.role !== 'string' || !isAssignableWorkspaceRole(body.role)) {
    return NextResponse.json({ success: false, error: 'Role is invalid' }, { status: 400 });
  }
  if (!Array.isArray(body.employeeCodes) || body.employeeCodes.some((code) => typeof code !== 'string')) {
    return NextResponse.json({ success: false, error: 'Employee code is invalid' }, { status: 400 });
  }
  try {
    const assignment = await replaceRoleMembers(body.role, body.employeeCodes);
    return NextResponse.json<ApiResponse<{ assignment: WorkspaceRoleAssignment }>>({
      success: true,
      data: { assignment },
    });
  } catch (error) {
    const message =
      error instanceof Error && !('code' in error) ? error.message : 'Could not save roles';
    const status = message === 'EXPENSE_DATABASE_URL is not configured' ? 503 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

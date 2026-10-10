import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { authorizeExpenseManagement } from '@/lib/workspace/authorization';
import { listRoleAssignments } from '@/lib/workspace/role-store';
import type { WorkspaceRoleAssignment } from '@/lib/workspace/roles';

export async function GET() {
  const session = await getServerSession(authOptions);
  let assignments: WorkspaceRoleAssignment[] = [];
  try {
    assignments = await listRoleAssignments();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message !== 'EXPENSE_DATABASE_URL is not configured') {
      return NextResponse.json({ success: false, error: 'Expense storage failed' }, { status: 500 });
    }
  }
  const decision = authorizeExpenseManagement(session, assignments);

  if (!decision.allowed) {
    return NextResponse.json(
      { success: false, error: decision.error },
      { status: decision.status }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      module: 'expense',
      status: 'not_implemented',
    },
  });
}

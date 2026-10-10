import { NextResponse } from 'next/server';
import { withExpenseDatabase } from '@/lib/expense/db/store';
import { expenseErrorResponse, requireExpenseEmployee } from '@/lib/expense/http';
import { deleteMonthlyClaim } from '@/lib/expense/prototype/service';
import { isAdministrator } from '@/lib/workspace/role-store';
import type { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function DELETE(_request: Request, context: { params: { id: string } }) {
  const access = await requireExpenseEmployee();
  if ('response' in access) return access.response;
  if (!(await isAdministrator(access.employee.id))) {
    return NextResponse.json(
      { success: false, error: 'Only an Administrator can delete a claim' },
      { status: 403 }
    );
  }
  try {
    await withExpenseDatabase((db) => deleteMonthlyClaim(db, context.params.id));
    return NextResponse.json<ApiResponse<{ id: string }>>({
      success: true,
      data: { id: context.params.id },
    });
  } catch (error) {
    return expenseErrorResponse(error);
  }
}

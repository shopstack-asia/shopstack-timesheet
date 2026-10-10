import { NextResponse } from 'next/server';
import { withExpenseDatabase } from '@/lib/expense/db/store';
import { expenseErrorResponse, requireExpenseEmployee } from '@/lib/expense/http';
import { markClaimPaid } from '@/lib/expense/prototype/service';
import type { MonthlyExpenseClaim } from '@/lib/expense/prototype/types';
import type { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: { id: string } }) {
  const access = await requireExpenseEmployee();
  if ('response' in access) return access.response;
  try {
    const claim = await withExpenseDatabase((db) => markClaimPaid(db, context.params.id));
    return NextResponse.json<ApiResponse<MonthlyExpenseClaim>>({ success: true, data: claim });
  } catch (error) {
    return expenseErrorResponse(error);
  }
}

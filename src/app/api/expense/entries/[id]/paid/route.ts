import { NextResponse } from 'next/server';
import { withExpenseDatabase } from '@/lib/expense/db/store';
import { expenseErrorResponse, requireExpenseEmployee } from '@/lib/expense/http';
import { markExpensePaid } from '@/lib/expense/prototype/service';
import type { ExpenseEntry } from '@/lib/expense/prototype/types';
import type { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: { id: string } }) {
  const access = await requireExpenseEmployee();
  if ('response' in access) return access.response;
  try {
    const entry = await withExpenseDatabase((db) => markExpensePaid(db, context.params.id));
    return NextResponse.json<ApiResponse<ExpenseEntry>>({ success: true, data: entry });
  } catch (error) {
    return expenseErrorResponse(error);
  }
}

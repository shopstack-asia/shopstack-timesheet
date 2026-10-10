import { NextResponse } from 'next/server';
import { withExpenseDatabase } from '@/lib/expense/db/store';
import { expenseErrorResponse, requireExpenseEmployee } from '@/lib/expense/http';
import { submitExpense } from '@/lib/expense/prototype/service';
import type { ExpenseEntry } from '@/lib/expense/prototype/types';
import type { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: { id: string } }) {
  const access = await requireExpenseEmployee();
  if ('response' in access) return access.response;
  try {
    const entry = await withExpenseDatabase(async (db) => {
      const current = (await db.listExpenses()).find((item) => item.id === context.params.id);
      if (!current) throw new Error('Expense not found');
      if (current.employeeId !== access.employee.id) throw new Error('You can only change your own expense');
      return submitExpense(db, current.id);
    });
    return NextResponse.json<ApiResponse<ExpenseEntry>>({ success: true, data: entry });
  } catch (error) {
    return expenseErrorResponse(error);
  }
}

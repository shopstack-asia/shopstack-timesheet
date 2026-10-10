import { NextResponse } from 'next/server';
import { withExpenseDatabase } from '@/lib/expense/db/store';
import { expenseErrorResponse, requireExpenseEmployee } from '@/lib/expense/http';
import { createMonthlyClaim, type ExpenseEmployee } from '@/lib/expense/prototype/service';
import type { ExpenseEntry, MonthlyExpenseClaim } from '@/lib/expense/prototype/types';
import type { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

function requesterFromExpenses(expenses: readonly ExpenseEntry[], employeeId: string): ExpenseEmployee {
  const entry = expenses.find((item) => item.employeeId === employeeId);
  if (!entry) throw new Error('Unknown employee');
  return {
    id: entry.employeeId,
    code: entry.employeeCode,
    name: entry.employeeName,
    businessUnit: entry.businessUnit,
  };
}

export async function POST(request: Request) {
  const access = await requireExpenseEmployee();
  if ('response' in access) return access.response;
  try {
    const body = (await request.json()) as {
      employeeId?: string;
      year?: number;
      month?: number;
      purpose?: string;
      claimDate?: string;
    };
    if (!body.employeeId || !body.year || !body.month || !body.claimDate) {
      throw new Error('Claim details are incomplete');
    }
    const claim = await withExpenseDatabase(async (db) => {
      const employee = requesterFromExpenses(await db.listExpenses(), body.employeeId!);
      return createMonthlyClaim(
        db,
        {
          employeeId: employee.id,
          year: body.year!,
          month: body.month!,
          purpose: body.purpose ?? '',
          claimDate: body.claimDate!,
        },
        employee
      );
    });
    return NextResponse.json<ApiResponse<MonthlyExpenseClaim>>({ success: true, data: claim });
  } catch (error) {
    return expenseErrorResponse(error);
  }
}

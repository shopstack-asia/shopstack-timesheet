import { NextResponse } from 'next/server';
import { withExpenseDatabase } from '@/lib/expense/db/store';
import { attachmentsFromForm, expenseErrorResponse, field, requireExpenseEmployee } from '@/lib/expense/http';
import { createExpense } from '@/lib/expense/prototype/service';
import type { ExpenseEntry } from '@/lib/expense/prototype/types';
import type { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const access = await requireExpenseEmployee();
  if ('response' in access) return access.response;
  try {
    const form = await request.formData();
    const files = await attachmentsFromForm(form);
    const entry = await withExpenseDatabase((db) =>
      createExpense(
        db,
        {
          employeeId: access.employee.id,
          expenseDate: field(form, 'expenseDate'),
          categoryCode: field(form, 'categoryCode'),
          description: field(form, 'description'),
          currency: field(form, 'currency') as ExpenseEntry['currency'],
          amount: field(form, 'amount'),
          exchangeRate: field(form, 'exchangeRate'),
          projectLabel: field(form, 'projectLabel'),
          attachmentCount: files.length,
          newAttachments: files,
          removeAttachmentIds: [],
        },
        access.employee
      )
    );
    return NextResponse.json<ApiResponse<ExpenseEntry>>({ success: true, data: entry });
  } catch (error) {
    return expenseErrorResponse(error);
  }
}

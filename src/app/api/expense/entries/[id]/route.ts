import { NextResponse } from 'next/server';
import { withExpenseDatabase } from '@/lib/expense/db/store';
import {
  attachmentsFromForm,
  expenseErrorResponse,
  field,
  removedAttachmentIds,
  requireExpenseEmployee,
} from '@/lib/expense/http';
import { deleteExpenseRecord, updateDraftExpense } from '@/lib/expense/prototype/service';
import { isAdministrator } from '@/lib/workspace/role-store';
import type { ExpenseEntry } from '@/lib/expense/prototype/types';
import type { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: { id: string } }) {
  const access = await requireExpenseEmployee();
  if ('response' in access) return access.response;
  try {
    const form = await request.formData();
    const files = await attachmentsFromForm(form);
    const entry = await withExpenseDatabase(async (db) => {
      const current = (await db.listExpenses()).find((item) => item.id === context.params.id);
      if (!current) throw new Error('Expense not found');
      if (current.employeeId !== access.employee.id) throw new Error('You can only change your own expense');
      return updateDraftExpense(
        db,
        current.id,
        {
          employeeId: current.employeeId,
          expenseDate: field(form, 'expenseDate'),
          categoryCode: field(form, 'categoryCode'),
          description: field(form, 'description'),
          currency: field(form, 'currency') as ExpenseEntry['currency'],
          amount: field(form, 'amount'),
          exchangeRate: field(form, 'exchangeRate'),
          projectLabel: field(form, 'projectLabel'),
          attachmentCount: 0,
          newAttachments: files,
          removeAttachmentIds: removedAttachmentIds(form),
        },
        access.employee
      );
    });
    return NextResponse.json<ApiResponse<ExpenseEntry>>({ success: true, data: entry });
  } catch (error) {
    return expenseErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: { id: string } }) {
  const access = await requireExpenseEmployee();
  if ('response' in access) return access.response;
  try {
    await withExpenseDatabase(async (db) => {
      const current = (await db.listExpenses()).find((item) => item.id === context.params.id);
      if (!current) throw new Error('Expense not found');
      const admin = await isAdministrator(access.employee.id);
      if (!admin && current.employeeId !== access.employee.id) {
        throw new Error('You can only change your own expense');
      }
      await deleteExpenseRecord(db, current.id, { anyStatus: admin });
    });
    return NextResponse.json<ApiResponse<{ id: string }>>({ success: true, data: { id: context.params.id } });
  } catch (error) {
    return expenseErrorResponse(error);
  }
}

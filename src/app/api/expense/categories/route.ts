import { NextResponse } from 'next/server';
import { withExpenseDatabase } from '@/lib/expense/db/store';
import { expenseErrorResponse, requireExpenseEmployee } from '@/lib/expense/http';
import { saveCategories } from '@/lib/expense/prototype/service';
import type { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  const access = await requireExpenseEmployee();
  if ('response' in access) return access.response;
  try {
    const body = (await request.json()) as { rows?: Array<{ code?: string; name?: string }> };
    if (!Array.isArray(body.rows)) throw new Error('Category list is invalid');
    const rows = body.rows.map((row) => ({ code: row.code ?? '', name: row.name ?? '' }));
    await withExpenseDatabase((db) => saveCategories(db, rows));
    return NextResponse.json<ApiResponse<{ saved: true }>>({ success: true, data: { saved: true } });
  } catch (error) {
    return expenseErrorResponse(error);
  }
}

import { NextResponse } from 'next/server';
import { withExpenseDatabase } from '@/lib/expense/db/store';
import { expenseErrorResponse, requireExpenseEmployee } from '@/lib/expense/http';
import { listCategories, resolveClaimStatus } from '@/lib/expense/prototype/service';
import type { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const access = await requireExpenseEmployee();
  if ('response' in access) return access.response;
  try {
    const data = await withExpenseDatabase(async (db) => {
      const expenses = await db.listExpenses();
      const storedClaims = await db.listClaims();
      const claims = storedClaims.map((claim) => ({ ...claim, status: resolveClaimStatus(claim, expenses) }));
      for (const claim of claims) {
        if (storedClaims.find((stored) => stored.id === claim.id)?.status !== claim.status) {
          await db.saveClaim(claim);
        }
      }
      const attachments = await db.listAttachments();
      return {
        employee: access.employee,
        expenses,
        claims,
        categories: await listCategories(db),
        attachments,
      };
    });
    return NextResponse.json<ApiResponse<typeof data>>({ success: true, data });
  } catch (error) {
    return expenseErrorResponse(error);
  }
}

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { expenseEmployeeFromProfile } from '@/lib/expense/employee';
import type { ExpenseEmployee, NewAttachment } from '@/lib/expense/prototype/service';

export async function requireExpenseEmployee(): Promise<
  { employee: ExpenseEmployee } | { response: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session?.staffProfile) {
    return {
      response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    };
  }
  try {
    return { employee: expenseEmployeeFromProfile(session.staffProfile) };
  } catch (error) {
    return {
      response: NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : 'Unauthorized' },
        { status: 401 }
      ),
    };
  }
}

export function expenseErrorResponse(error: unknown): NextResponse {
  const message =
    error instanceof Error && !('code' in error) ? error.message : 'Expense storage failed';
  const status = message === 'EXPENSE_DATABASE_URL is not configured'
    ? 503
    : message.includes('not found')
      ? 404
      : message.startsWith('You can only')
        ? 403
        : 400;
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function attachmentsFromForm(form: FormData): Promise<NewAttachment[]> {
  const attachments: NewAttachment[] = [];
  for (const value of form.getAll('files')) {
    if (!(value instanceof File) || value.size === 0) continue;
    const bytes = new Uint8Array(await value.arrayBuffer());
    attachments.push({
      fileName: value.name,
      mimeType: value.type,
      size: value.size,
      blob: new Blob([bytes], { type: value.type || 'application/octet-stream' }),
    });
  }
  return attachments;
}

export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export function removedAttachmentIds(form: FormData): string[] {
  const raw = field(form, 'removeAttachmentIds');
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Attachment removal list is invalid');
  }
  return parsed;
}

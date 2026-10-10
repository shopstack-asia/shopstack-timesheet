import { NextResponse } from 'next/server';
import { withExpenseDatabase } from '@/lib/expense/db/store';
import { expenseErrorResponse, requireExpenseEmployee } from '@/lib/expense/http';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: { id: string } }) {
  const access = await requireExpenseEmployee();
  if ('response' in access) return access.response;
  try {
    const attachment = await withExpenseDatabase((db) => db.getAttachment(context.params.id));
    if (!attachment) {
      return NextResponse.json({ success: false, error: 'Attachment not found' }, { status: 404 });
    }
    const bytes = new Uint8Array(await attachment.blob.arrayBuffer());
    const filename = encodeURIComponent(attachment.fileName);
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': attachment.mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename*=UTF-8''${filename}`,
      },
    });
  } catch (error) {
    return expenseErrorResponse(error);
  }
}

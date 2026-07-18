import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ApiResponse } from '@/types';
import { z } from 'zod';
import { submitDayTimesheetForStaff } from '@/lib/timesheet/timesheet-service';
import { SheetsWriteLockError } from '@/lib/sheets-write-lock';
import { SubmitPolicyError } from '@/lib/timesheet/submit-policy';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const submitTimesheetSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(
    z.object({
      projectId: z.string().min(1),
      taskId: z.string().min(1),
      hours: z.number().min(0).max(24),
    })
  ),
  leaveOverride: z.boolean().optional(),
  holidayAcknowledged: z.boolean().optional(),
  futureAcknowledged: z.boolean().optional(),
  over24Acknowledged: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.staffProfile) {
      return NextResponse.json<ApiResponse<void>>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const limited = await enforceRateLimit(request, {
      bucket: 'timesheet-submit',
      limit: 60,
      windowSeconds: 60,
      userKey: session.staffProfile.EmployeeID,
    });
    if (!limited.ok) return limited.response;

    const body = await request.json();
    const validationResult = submitTimesheetSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json<ApiResponse<void>>(
        {
          success: false,
          error: `Validation error: ${validationResult.error.message}`,
        },
        { status: 400 }
      );
    }

    const {
      date,
      entries,
      leaveOverride,
      holidayAcknowledged,
      futureAcknowledged,
      over24Acknowledged,
    } = validationResult.data;

    await submitDayTimesheetForStaff(
      { staff: session.staffProfile, source: 'session' },
      date,
      entries,
      {
        allowCustomProject: true,
        leaveOverride,
        holidayAcknowledged,
        futureAcknowledged,
        over24Acknowledged,
      }
    );

    return NextResponse.json<ApiResponse<void>>({ success: true });
  } catch (error) {
    console.error('Error submitting timesheet:', error);

    if (error instanceof SubmitPolicyError) {
      return NextResponse.json<ApiResponse<void>>(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    if (
      error instanceof SheetsWriteLockError ||
      (error instanceof Error &&
        'statusCode' in error &&
        (error as Error & { statusCode?: number }).statusCode === 503)
    ) {
      const message =
        error instanceof Error ? error.message : 'Timesheet is busy, please try again';
      return NextResponse.json<ApiResponse<void>>(
        { success: false, error: message },
        { status: 503 }
      );
    }

    const message =
      error instanceof Error ? error.message : 'Failed to submit timesheet';
    const status =
      message.startsWith('Invalid task ID') ||
      message.startsWith('Validation') ||
      message.startsWith('Unknown project')
        ? 400
        : 500;

    return NextResponse.json<ApiResponse<void>>(
      {
        success: false,
        error: status === 500 ? 'Failed to submit timesheet' : message,
      },
      { status }
    );
  }
}

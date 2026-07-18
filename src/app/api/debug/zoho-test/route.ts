import { NextRequest, NextResponse } from 'next/server';
import { assertDebugAccess } from '@/lib/debug-auth';
import { getZohoPeopleService } from '@/lib/zoho-people';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const denied = assertDebugAccess(request);
  if (denied) return denied;

  const limited = await enforceRateLimit(request, {
    bucket: 'debug-zoho',
    limit: 20,
    windowSeconds: 60,
  });
  if (!limited.ok) return limited.response;

  const email = request.nextUrl.searchParams.get('email');

  try {
    if (!email || !email.toLowerCase().endsWith('@shopstack.asia')) {
      return NextResponse.json(
        { success: false, error: 'Provide a @shopstack.asia email query parameter' },
        { status: 400 }
      );
    }

    const zohoService = getZohoPeopleService();
    const staffProfile = await zohoService.getEmployeeByEmail(email);

    if (!staffProfile) {
      return NextResponse.json({
        success: false,
        message: 'Employee not found',
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Employee found',
      profile: {
        EmployeeID: staffProfile.EmployeeID,
        FirstName: staffProfile.FirstName,
        LastName: staffProfile.LastName,
        Email: staffProfile.Email,
        Position: staffProfile.Position,
      },
    });
  } catch (error) {
    console.error('Zoho test error:', error);
    return NextResponse.json(
      { success: false, error: 'Zoho lookup failed' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ApiResponse, StaffProfile } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json<ApiResponse<StaffProfile>>(
        {
          success: false,
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

    // Return staff profile from session
    if (!session.staffProfile) {
      return NextResponse.json<ApiResponse<StaffProfile>>(
        {
          success: false,
          error: 'Staff profile not found',
        },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResponse<StaffProfile>>({
      success: true,
      data: session.staffProfile,
    });
  } catch (error) {
    console.error('Error fetching staff profile:', error);
    return NextResponse.json<ApiResponse<StaffProfile>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch staff profile',
      },
      { status: 500 }
    );
  }
}


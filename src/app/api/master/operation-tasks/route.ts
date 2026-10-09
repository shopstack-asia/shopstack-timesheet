import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCachedOperationTasks } from '@/lib/google-sheets';
import { ApiResponse } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json<ApiResponse<string[]>>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const tasks = await getCachedOperationTasks();
    return NextResponse.json<ApiResponse<string[]>>({
      success: true,
      data: tasks,
    });
  } catch (error) {
    console.error('Error fetching operation tasks:', error);
    return NextResponse.json<ApiResponse<string[]>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch operation tasks',
      },
      { status: 500 }
    );
  }
}

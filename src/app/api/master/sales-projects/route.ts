import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import {
  getCachedSalesProjects,
  getGoogleSheetsService,
} from '@/lib/google-sheets';
import { DuplicateSalesProjectCodeError, uniqueSortedClients } from '@/lib/timesheet/task-type';
import { ApiResponse, SalesProject } from '@/types';

export const dynamic = 'force-dynamic';

const createSalesProjectSchema = z.object({
  projectClient: z.string().trim().min(1),
  projectName: z.string().trim().min(1),
  projectCode: z.string().trim().min(1),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json<ApiResponse<SalesProject[]>>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const projects = await getCachedSalesProjects();
    return NextResponse.json<
      ApiResponse<{ projects: SalesProject[]; clients: string[] }>
    >({
      success: true,
      data: {
        projects,
        clients: uniqueSortedClients(projects.map((project) => project.ProjectClient)),
      },
    });
  } catch (error) {
    console.error('Error fetching sales projects:', error);
    return NextResponse.json<ApiResponse<SalesProject[]>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch sales projects',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json<ApiResponse<SalesProject>>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parsed = createSalesProjectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<SalesProject>>(
        {
          success: false,
          error: 'Client, project name, and project code are required',
        },
        { status: 400 }
      );
    }

    const created = await getGoogleSheetsService().createSalesProject(parsed.data);
    return NextResponse.json<ApiResponse<SalesProject>>({
      success: true,
      data: created,
    });
  } catch (error) {
    if (error instanceof DuplicateSalesProjectCodeError) {
      return NextResponse.json<ApiResponse<SalesProject>>(
        { success: false, error: error.message },
        { status: 409 }
      );
    }
    console.error('Error creating sales project:', error);
    return NextResponse.json<ApiResponse<SalesProject>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create sales project',
      },
      { status: 500 }
    );
  }
}

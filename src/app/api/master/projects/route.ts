import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCachedProjects } from '@/lib/google-sheets';
import { ApiResponse, Project } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json<ApiResponse<Project[]>>(
        {
          success: false,
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

    // Get projects from cache or Google Sheets
    const projects = await getCachedProjects();

    // Extract unique project clients
    const uniqueClients = Array.from(
      new Set(projects.map((p) => p.ProjectClient).filter((client) => client))
    ).sort();

    return NextResponse.json<ApiResponse<{ projects: Project[]; clients: string[] }>>({
      success: true,
      data: {
        projects,
        clients: uniqueClients,
      },
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json<ApiResponse<Project[]>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch projects',
      },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getGoogleSheetsService, getCachedProjects, getCachedTasks } from '@/lib/google-sheets';
import { ApiResponse, TimeLogRow, TimeEntry } from '@/types';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// Validation schema
const submitTimesheetSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(
    z.object({
      projectId: z.string().min(1),
      taskId: z.string().min(1),
      hours: z.number().min(0).max(24),
    })
  ),
});

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !session.staffProfile) {
      return NextResponse.json<ApiResponse<void>>(
        {
          success: false,
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

    // Parse and validate request body
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

    const { date, entries } = validationResult.data;

    // Validate that entries exist
    if (entries.length === 0) {
      return NextResponse.json<ApiResponse<void>>(
        {
          success: false,
          error: 'At least one entry is required',
        },
        { status: 400 }
      );
    }

    // Get master data
    const [projects, tasks] = await Promise.all([
      getCachedProjects(),
      getCachedTasks(),
    ]);

    // Create lookup maps
    const projectMap = new Map(projects.map((p) => [p.ProjectID, p]));
    const taskMap = new Map(tasks.map((t) => [t.TaskID, t]));

    // Validate all entries reference valid projects and tasks
    for (const entry of entries) {
      if (!projectMap.has(entry.projectId)) {
        return NextResponse.json<ApiResponse<void>>(
          {
            success: false,
            error: `Invalid project ID: ${entry.projectId}`,
          },
          { status: 400 }
        );
      }
      if (!taskMap.has(entry.taskId)) {
        return NextResponse.json<ApiResponse<void>>(
          {
            success: false,
            error: `Invalid task ID: ${entry.taskId}`,
          },
          { status: 400 }
        );
      }
    }

    // Get Google Sheets service
    const sheetsService = getGoogleSheetsService();
    
    // Get last Time Log ID for new entries
    const lastId = await sheetsService.getLastTimeLogId();
    let newIdCounter = 0;

    // Prepare time log rows
    const timeLogRows: TimeLogRow[] = entries.map((entry) => {
      const project = projectMap.get(entry.projectId)!;
      const task = taskMap.get(entry.taskId)!;

      // Generate new ID for now (will be replaced if entry exists during appendOrUpdate)
      const timeLogId = lastId + (++newIdCounter);

      return {
        'Time Log ID': timeLogId,
        Date: date,
        'Staff ID': session.staffProfile!.EmployeeID,
        'Staff First Name': session.staffProfile!.FirstName,
        'Staff Last Name': session.staffProfile!.LastName,
        'Staff Position': session.staffProfile!.Position,
        'Project ID': project.ProjectID,
        'Project Client': project.ProjectClient,
        'Project Name': project.ProjectName,
        'Project Code': project.ProjectCode,
        'Task ID': task.TaskID,
        Task: task.Task,
        Hours: entry.hours,
      };
    });

    // Write to Google Sheets (will update existing or append new)
    // The appendOrUpdateTimeLogEntries method will check for duplicates and update accordingly
    await sheetsService.appendOrUpdateTimeLogEntries(timeLogRows);

    return NextResponse.json<ApiResponse<void>>({
      success: true,
    });
  } catch (error) {
    console.error('Error submitting timesheet:', error);
    return NextResponse.json<ApiResponse<void>>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to submit timesheet',
      },
      { status: 500 }
    );
  }
}


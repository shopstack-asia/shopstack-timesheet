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
      projectId: z.string().min(1), // Can be either a valid project ID or a custom project name
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

    // Note: entries can be empty array to delete all entries for the day

    // Get master data
    const [projects, tasks] = await Promise.all([
      getCachedProjects(),
      getCachedTasks(),
    ]);

    // Create lookup maps
    const projectMap = new Map(projects.map((p) => [p.ProjectID, p]));
    const taskMap = new Map(tasks.map((t) => [t.TaskID, t]));

    // Validate all entries reference valid tasks (only if entries exist)
    // Note: projectId can be either a valid project ID or a custom project name (text)
    if (entries.length > 0) {
      for (const entry of entries) {
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
    }

    // Get Google Sheets service
    const sheetsService = getGoogleSheetsService();
    
    // Get existing entries for this date and staff from Google Sheets
    const existingEntries = await sheetsService.getTimeLogEntriesByDateAndStaff(
      date,
      session.staffProfile!.EmployeeID
    );

    // Create a map of existing entries by Project ID + Task ID for comparison
    const existingEntriesMap = new Map<string, { rowNumber: number; entry: TimeLogRow }>();
    existingEntries.forEach(({ rowNumber, entry }) => {
      const key = `${entry['Project ID']}|${entry['Task ID']}`;
      existingEntriesMap.set(key, { rowNumber, entry });
    });

    // Create a set of submitted entries by Project ID/Name + Task ID
    const submittedEntriesSet = new Set<string>();
    entries.forEach((entry) => {
      // projectId can be either a valid project ID or a custom project name
      const key = `${entry.projectId}|${entry.taskId}`;
      submittedEntriesSet.add(key);
    });

    // Find entries to delete (exist in Google Sheets but not in submitted entries)
    const entriesToDelete: number[] = [];
    existingEntriesMap.forEach(({ rowNumber, entry }, key) => {
      if (!submittedEntriesSet.has(key)) {
        entriesToDelete.push(rowNumber);
      }
    });

    // Delete entries that were removed
    if (entriesToDelete.length > 0) {
      await sheetsService.deleteTimeLogEntries(entriesToDelete);
      // console.log(`[API] Deleted ${entriesToDelete.length} removed entries for date ${date}`);
    }

    // Prepare time log rows for entries to add/update
    // First, handle custom projects (create them in Projects sheet)
    const projectCreationPromises: Promise<void>[] = [];
    const projectIdMap = new Map<string, string>(); // Maps custom project name to created Project ID
    
    for (const entry of entries) {
      const project = projectMap.get(entry.projectId);
      // If projectId is not found in projectMap, it's a custom project name
      if (!project) {
        // Check if we've already created this project in this batch
        if (!projectIdMap.has(entry.projectId)) {
          // Create new project in Projects sheet
          const createPromise = sheetsService.createProject(entry.projectId).then((newProject) => {
            projectIdMap.set(entry.projectId, newProject.ProjectID);
            // Update projectMap with the new project
            projectMap.set(newProject.ProjectID, newProject);
          });
          projectCreationPromises.push(createPromise);
        }
      }
    }
    
    // Wait for all project creations to complete
    if (projectCreationPromises.length > 0) {
      await Promise.all(projectCreationPromises);
      // Refresh projects list after creating new projects
      const updatedProjects = await getCachedProjects();
      updatedProjects.forEach((p) => {
        if (!projectMap.has(p.ProjectID)) {
          projectMap.set(p.ProjectID, p);
        }
      });
    }
    
    // Now prepare time log rows
    const timeLogRows: TimeLogRow[] = entries.map((entry) => {
      const task = taskMap.get(entry.taskId)!;
      
      // Check if projectId is a valid project ID or a custom project name
      let project = projectMap.get(entry.projectId);
      
      // If not found, it might be a custom project name that we just created
      if (!project && projectIdMap.has(entry.projectId)) {
        const createdProjectId = projectIdMap.get(entry.projectId)!;
        project = projectMap.get(createdProjectId);
      }
      
      if (!project) {
        throw new Error(`Project not found: ${entry.projectId}`);
      }
      
      const projectData = {
        ProjectID: project.ProjectID,
        ProjectClient: project.ProjectClient,
        ProjectName: project.ProjectName,
        ProjectCode: project.ProjectCode,
      };

      // Generate Time Log ID from Date + Staff ID + Project ID + Task ID
      const timeLogId = sheetsService.generateTimeLogId(
        date,
        session.staffProfile!.EmployeeID,
        projectData.ProjectID,
        task.TaskID
      );

      return {
        'Time Log ID': timeLogId,
        Date: date,
        'Staff ID': session.staffProfile!.EmployeeID,
        'Staff First Name': session.staffProfile!.FirstName,
        'Staff Last Name': session.staffProfile!.LastName,
        'Staff Position': session.staffProfile!.Position,
        'Project ID': projectData.ProjectID,
        'Project Client': projectData.ProjectClient,
        'Project Name': projectData.ProjectName,
        'Project Code': projectData.ProjectCode,
        'Task ID': task.TaskID,
        Task: task.Task,
        Hours: entry.hours,
      };
    });

    // Write to Google Sheets (will update existing or append new)
    // The appendOrUpdateTimeLogEntries method will check for duplicates and update accordingly
    if (timeLogRows.length > 0) {
      await sheetsService.appendOrUpdateTimeLogEntries(timeLogRows);
    }

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


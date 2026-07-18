import { getGoogleSheetsService } from '@/lib/google-sheets';
import { TimeEntry, TimeLogRow } from '@/types';
import { AgentAuthContext, assertAgentAuth } from '@/lib/timesheet/agent-auth';

/**
 * Load week Time Log entries for the authenticated employee (Mon–Sun).
 */
export async function getWeeklyTimesheetForStaff(
  ctx: AgentAuthContext,
  weekStart: string
): Promise<Record<string, TimeEntry[]>> {
  assertAgentAuth(ctx);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new Error('weekStart must be YYYY-MM-DD');
  }

  const startDate = new Date(weekStart);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const sheetsService = getGoogleSheetsService();
  const timeLogEntries = await sheetsService.getTimeLogEntries(startDateStr, endDateStr);

  const staffEntries = timeLogEntries.filter(
    (entry) => entry['Staff ID'] === ctx.staff.EmployeeID
  );

  const entriesByDate: Record<string, TimeEntry[]> = {};
  const seenIds = new Set<string>();

  staffEntries.forEach((entry) => {
    const date = entry.Date;
    const uniqueId =
      entry['Time Log ID'] ||
      `existing-${date}-${entry['Project ID']}-${entry['Task ID']}`;

    if (seenIds.has(uniqueId)) {
      return;
    }
    seenIds.add(uniqueId);

    if (!entriesByDate[date]) {
      entriesByDate[date] = [];
    }

    entriesByDate[date].push({
      id: uniqueId,
      projectId: entry['Project ID'],
      taskId: entry['Task ID'],
      hours: entry.Hours,
    });
  });

  return entriesByDate;
}

export type SubmitDayEntryInput = {
  projectId: string;
  taskId: string;
  hours: number;
};

export type SubmitDayOptions = {
  /** When false (Slack agent), unknown projectId is an error — never createProject */
  allowCustomProject?: boolean;
};

/**
 * Replace all Time Log rows for date + staff (same semantics as POST /api/timesheet/submit).
 * Order: validate → resolve projects → prepare rows → upsert → delete obsolete (inside lock).
 */
export async function submitDayTimesheetForStaff(
  ctx: AgentAuthContext,
  date: string,
  entries: SubmitDayEntryInput[],
  options: SubmitDayOptions = {}
): Promise<void> {
  const allowCustomProject = options.allowCustomProject !== false;

  const { withTimeLogWriteLock, SheetsWriteLockError } = await import(
    '@/lib/sheets-write-lock'
  );
  const { getCachedProjects, getCachedTasks, getGoogleSheetsService } = await import(
    '@/lib/google-sheets'
  );
  const { z } = await import('zod');

  assertAgentAuth(ctx);

  const schema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    entries: z.array(
      z.object({
        projectId: z.string().min(1),
        taskId: z.string().min(1),
        hours: z.number().min(0).max(24),
      })
    ),
  });

  const parsed = schema.safeParse({ date, entries });
  if (!parsed.success) {
    throw new Error(`Validation error: ${parsed.error.message}`);
  }

  // Validate master data BEFORE lock / mutations
  const [projects, tasks] = await Promise.all([getCachedProjects(), getCachedTasks()]);
  const projectMap = new Map(projects.map((p) => [p.ProjectID, p]));
  const taskMap = new Map(tasks.map((t) => [t.TaskID, t]));

  for (const entry of parsed.data.entries) {
    if (!taskMap.has(entry.taskId)) {
      throw new Error(`Invalid task ID: ${entry.taskId}`);
    }
    if (!allowCustomProject && !projectMap.has(entry.projectId)) {
      throw new Error(
        `Unknown project ID: ${entry.projectId}. Custom project creation is not allowed via this path.`
      );
    }
  }

  try {
    await withTimeLogWriteLock(async () => {
      const sheetsService = getGoogleSheetsService();

      // Resolve / create custom projects first (web only), before any deletes
      const projectIdMap = new Map<string, string>();
      if (allowCustomProject) {
        for (const entry of parsed.data.entries) {
          if (!projectMap.has(entry.projectId) && !projectIdMap.has(entry.projectId)) {
            const newProject = await sheetsService.createProject(entry.projectId);
            projectIdMap.set(entry.projectId, newProject.ProjectID);
            projectMap.set(newProject.ProjectID, newProject);
          }
        }
        if (projectIdMap.size > 0) {
          const updatedProjects = await getCachedProjects();
          updatedProjects.forEach((p) => {
            if (!projectMap.has(p.ProjectID)) {
              projectMap.set(p.ProjectID, p);
            }
          });
        }
      }

      // Build final TimeLogRow set (fail before deletes if anything missing)
      const timeLogRows: TimeLogRow[] = parsed.data.entries.map((entry) => {
        const task = taskMap.get(entry.taskId)!;
        let project = projectMap.get(entry.projectId);
        if (!project && projectIdMap.has(entry.projectId)) {
          project = projectMap.get(projectIdMap.get(entry.projectId)!);
        }
        if (!project) {
          throw new Error(`Project not found: ${entry.projectId}`);
        }

        const resolvedProjectId = project.ProjectID;
        const timeLogId = sheetsService.generateTimeLogId(
          parsed.data.date,
          ctx.staff.EmployeeID,
          resolvedProjectId,
          task.TaskID
        );

        return {
          'Time Log ID': timeLogId,
          Date: parsed.data.date,
          'Staff ID': ctx.staff.EmployeeID,
          'Staff First Name': ctx.staff.FirstName,
          'Staff Last Name': ctx.staff.LastName,
          'Staff Position': ctx.staff.Position,
          'Project ID': resolvedProjectId,
          'Project Client': project.ProjectClient,
          'Project Name': project.ProjectName,
          'Project Code': project.ProjectCode,
          'Task ID': task.TaskID,
          Task: task.Task,
          Hours: entry.hours,
        };
      });

      const existingEntries = await sheetsService.getTimeLogEntriesByDateAndStaff(
        parsed.data.date,
        ctx.staff.EmployeeID
      );

      const existingEntriesMap = new Map<
        string,
        { rowNumber: number; entry: TimeLogRow }
      >();
      existingEntries.forEach(({ rowNumber, entry }) => {
        const key = `${entry['Project ID']}|${entry['Task ID']}`;
        existingEntriesMap.set(key, { rowNumber, entry });
      });

      const submittedKeys = new Set(
        timeLogRows.map((r) => `${r['Project ID']}|${r['Task ID']}`)
      );

      const snapshotRows = existingEntries.map(({ entry }) => ({ ...entry }));

      // Upsert first — preserves data if this fails
      if (timeLogRows.length > 0) {
        await sheetsService.appendOrUpdateTimeLogEntries(timeLogRows);
      }

      // Delete obsolete only after upsert succeeds (or clear-all when empty payload)
      const entriesToDelete: number[] = [];
      existingEntriesMap.forEach(({ rowNumber }, key) => {
        if (timeLogRows.length === 0 || !submittedKeys.has(key)) {
          entriesToDelete.push(rowNumber);
        }
      });

      if (entriesToDelete.length > 0) {
        try {
          await sheetsService.deleteTimeLogEntries(entriesToDelete);
        } catch (deleteError) {
          console.error(
            '[submitDayTimesheetForStaff] Delete after upsert failed; attempting snapshot restore',
            deleteError
          );
          try {
            if (snapshotRows.length > 0) {
              await sheetsService.appendOrUpdateTimeLogEntries(snapshotRows);
            }
          } catch (restoreError) {
            console.error(
              '[submitDayTimesheetForStaff] Compensating restore failed',
              restoreError
            );
          }
          throw deleteError instanceof Error
            ? deleteError
            : new Error('Failed to delete obsolete time log rows');
        }
      }
    });
  } catch (error) {
    if (error instanceof SheetsWriteLockError) {
      const message =
        error.code === 'LOCK_TIMEOUT'
          ? 'Timesheet is busy, please try again'
          : 'Timesheet write lock unavailable, please try again';
      const err = new Error(message) as Error & { statusCode: number; code: string };
      err.statusCode = 503;
      err.code = error.code;
      throw err;
    }
    throw error;
  }
}

export async function clearDayTimesheetForStaff(
  ctx: AgentAuthContext,
  date: string,
  options?: SubmitDayOptions
): Promise<void> {
  return submitDayTimesheetForStaff(ctx, date, [], options);
}

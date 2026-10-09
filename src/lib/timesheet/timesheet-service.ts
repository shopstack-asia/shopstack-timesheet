import { getGoogleSheetsService } from '@/lib/google-sheets';
import { Project, SalesProject, Task, TimeEntry, TimeLogRow, TimesheetTaskType } from '@/types';
import { AgentAuthContext, assertAgentAuth } from '@/lib/timesheet/agent-auth';
import {
  findSalesProject,
  isShopstackClient,
  operationTimeLogFields,
  resolveOperationTaskName,
  salesTimeLogFields,
  TASK_TYPE_INTERNAL_DEVELOPMENT,
  TASK_TYPE_INTERNAL_OPERATIONS,
  TASK_TYPE_PROJECT_DELIVERY,
  TASK_TYPE_SALES_PRESALES,
  timeLogRowIdentity,
  timeLogRowToTimeEntry,
  timeLogSyncKey,
  type ResolvedTimeLogFields,
} from '@/lib/timesheet/task-type';

/** Calendar-day arithmetic in UTC date parts (YYYY-MM-DD). */
function addCalendarDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d! + deltaDays));
  const yyyy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export type TimeLogRowsLoader = (
  startDate: string,
  endDate: string
) => Promise<TimeLogRow[]>;

/**
 * Load Time Log rows for one staff member over an inclusive calendar range.
 * Shared by the Weekly Timesheet UI path and AI Business Tools (canonical read).
 */
export async function getTimeLogRowsForStaffRange(
  ctx: AgentAuthContext,
  startDate: string,
  endDate: string,
  loader?: TimeLogRowsLoader
): Promise<TimeLogRow[]> {
  assertAgentAuth(ctx);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('startDate and endDate must be YYYY-MM-DD');
  }
  if (startDate > endDate) {
    throw new Error('startDate must not be after endDate');
  }

  const fetchRows =
    loader ??
    ((start, end) => getGoogleSheetsService().getTimeLogEntries(start, end));

  const timeLogEntries = await fetchRows(startDate, endDate);
  const staffId = ctx.staff.EmployeeID.trim();

  const seenIds = new Set<string>();
  const staffEntries: TimeLogRow[] = [];

  for (const entry of timeLogEntries) {
    if (String(entry['Staff ID'] || '').trim() !== staffId) {
      continue;
    }
    const uniqueId = timeLogRowIdentity(entry);
    if (seenIds.has(uniqueId)) {
      continue;
    }
    seenIds.add(uniqueId);
    staffEntries.push(entry);
  }

  return staffEntries;
}

/**
 * Load week Time Log entries for the authenticated employee (Mon–Sun).
 * Used by GET /api/timesheet/get (Weekly Timesheet UI).
 */
export async function getWeeklyTimesheetForStaff(
  ctx: AgentAuthContext,
  weekStart: string,
  loader?: TimeLogRowsLoader
): Promise<Record<string, TimeEntry[]>> {
  assertAgentAuth(ctx);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new Error('weekStart must be YYYY-MM-DD');
  }

  // Calendar arithmetic (avoid UTC Date parsing off-by-one)
  const startDateStr = weekStart;
  const endDateStr = addCalendarDays(weekStart, 6);

  const staffEntries = await getTimeLogRowsForStaffRange(
    ctx,
    startDateStr,
    endDateStr,
    loader
  );

  const entriesByDate: Record<string, TimeEntry[]> = {};

  staffEntries.forEach((entry) => {
    const date = entry.Date;
    if (!entriesByDate[date]) {
      entriesByDate[date] = [];
    }

    entriesByDate[date].push(timeLogRowToTimeEntry(entry));
  });

  return entriesByDate;
}

export type SubmitDayEntryInput = {
  taskType?: TimesheetTaskType;
  projectId: string;
  taskId: string;
  hours: number;
  projectClient?: string;
  projectName?: string;
  projectCode?: string;
  taskName?: string;
};

function entryTaskType(entry: SubmitDayEntryInput): TimesheetTaskType {
  return entry.taskType ?? TASK_TYPE_PROJECT_DELIVERY;
}

function syncKeyForRow(entry: TimeLogRow): string {
  return timeLogSyncKey({
    projectId: entry['Project ID'],
    taskId: entry['Task ID'],
    projectCode: entry['Project Code'],
    taskName: entry.Task,
  });
}

function resolveSubmitFields(
  entry: SubmitDayEntryInput,
  deps: {
    projectMap: Map<string, Project>;
    projectIdMap: Map<string, string>;
    taskMap: Map<string, Task>;
    salesProjects: SalesProject[];
    operationTasks: string[];
  }
): ResolvedTimeLogFields {
  const taskType = entryTaskType(entry);
  if (taskType === TASK_TYPE_SALES_PRESALES) {
    const sales = findSalesProject(deps.salesProjects, entry.projectCode || '');
    if (!sales) {
      throw new Error(`Invalid sales project code: ${entry.projectCode || '(empty)'}`);
    }
    return salesTimeLogFields(sales);
  }
  if (taskType === TASK_TYPE_INTERNAL_OPERATIONS) {
    const taskName = resolveOperationTaskName(deps.operationTasks, entry.taskName || '');
    if (!taskName) {
      throw new Error(`Invalid operation task: ${entry.taskName || '(empty)'}`);
    }
    return operationTimeLogFields(taskName);
  }

  const task = deps.taskMap.get(entry.taskId);
  if (!task) {
    throw new Error(`Invalid task ID: ${entry.taskId}`);
  }
  let project = deps.projectMap.get(entry.projectId);
  if (!project && deps.projectIdMap.has(entry.projectId)) {
    project = deps.projectMap.get(deps.projectIdMap.get(entry.projectId)!);
  }
  if (!project) {
    throw new Error(`Project not found: ${entry.projectId}`);
  }
  if (
    taskType === TASK_TYPE_INTERNAL_DEVELOPMENT &&
    !isShopstackClient(project.ProjectClient)
  ) {
    throw new Error(`Invalid internal development project: ${entry.projectId}`);
  }
  return {
    projectId: project.ProjectID,
    projectClient: project.ProjectClient,
    projectName: project.ProjectName,
    projectCode: project.ProjectCode,
    taskId: task.TaskID,
    taskName: task.Task,
  };
}

export type SubmitDayOptions = {
  /** When false (Slack agent), unknown projectId is an error — never createProject */
  allowCustomProject?: boolean;
  leaveOverride?: boolean;
  holidayAcknowledged?: boolean;
  futureAcknowledged?: boolean;
  over24Acknowledged?: boolean;
  requestId?: string;
};

type SheetsDayMutator = {
  getTimeLogEntriesByDateAndStaff: (
    date: string,
    staffId: string
  ) => Promise<Array<{ rowNumber: number; entry: TimeLogRow }>>;
  appendOrUpdateTimeLogEntries: (entries: TimeLogRow[]) => Promise<void>;
  deleteTimeLogEntries: (rowNumbers: number[]) => Promise<void>;
};

/**
 * Restore a staff/date day to an exact row snapshot after a failed mutation.
 * Upserts snapshot rows, then deletes any keys not present in the snapshot
 * (including rows added by a prior upsert in the same failed write).
 */
async function restoreDayToSnapshot(
  sheetsService: SheetsDayMutator,
  date: string,
  staffId: string,
  snapshotRows: TimeLogRow[]
): Promise<void> {
  if (snapshotRows.length > 0) {
    await sheetsService.appendOrUpdateTimeLogEntries(snapshotRows);
  }

  const current = await sheetsService.getTimeLogEntriesByDateAndStaff(date, staffId);
  const snapshotKeys = new Set(snapshotRows.map((row) => syncKeyForRow(row)));

  const extras = current
    .filter(({ entry }) => !snapshotKeys.has(syncKeyForRow(entry)))
    .map(({ rowNumber }) => rowNumber);

  if (extras.length > 0) {
    await sheetsService.deleteTimeLogEntries(extras);
  }
}

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
  const sheetsMod = await import('@/lib/google-sheets');
  const { getCachedProjects, getCachedTasks, getGoogleSheetsService } = sheetsMod;
  const { z } = await import('zod');

  assertAgentAuth(ctx);

  const schema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    entries: z.array(
      z.object({
        taskType: z
          .enum([
            TASK_TYPE_PROJECT_DELIVERY,
            TASK_TYPE_SALES_PRESALES,
            TASK_TYPE_INTERNAL_DEVELOPMENT,
            TASK_TYPE_INTERNAL_OPERATIONS,
          ])
          .optional(),
        projectId: z.string().min(1),
        taskId: z.string().min(1),
        hours: z.number().min(0).max(24),
        projectClient: z.string().optional(),
        projectName: z.string().optional(),
        projectCode: z.string().optional(),
        taskName: z.string().optional(),
      })
    ),
  });

  const parsed = schema.safeParse({ date, entries });
  if (!parsed.success) {
    throw new Error(`Validation error: ${parsed.error.message}`);
  }

  const { assertSubmitBusinessRules, SubmitPolicyError } = await import(
    '@/lib/timesheet/submit-policy'
  );
  try {
    await assertSubmitBusinessRules(ctx, parsed.data.date, parsed.data.entries, {
      leaveOverride: options.leaveOverride,
      holidayAcknowledged: options.holidayAcknowledged,
      futureAcknowledged: options.futureAcknowledged,
      over24Acknowledged: options.over24Acknowledged,
    }, { requestId: options.requestId });
  } catch (error) {
    if (error instanceof SubmitPolicyError) {
      throw error;
    }
    throw error;
  }

  const needsSales = parsed.data.entries.some(
    (entry) => entryTaskType(entry) === TASK_TYPE_SALES_PRESALES
  );
  const needsOperations = parsed.data.entries.some(
    (entry) => entryTaskType(entry) === TASK_TYPE_INTERNAL_OPERATIONS
  );

  // Validate master data BEFORE lock / mutations
  const [projects, tasks, salesProjects, operationTasks] = await Promise.all([
    getCachedProjects(),
    getCachedTasks(),
    needsSales ? sheetsMod.getCachedSalesProjects() : Promise.resolve([]),
    needsOperations ? sheetsMod.getCachedOperationTasks() : Promise.resolve([]),
  ]);
  const projectMap = new Map(projects.map((p) => [p.ProjectID, p]));
  const taskMap = new Map(tasks.map((t) => [t.TaskID, t]));

  for (const entry of parsed.data.entries) {
    const taskType = entryTaskType(entry);
    if (taskType === TASK_TYPE_SALES_PRESALES) {
      if (!findSalesProject(salesProjects, entry.projectCode || '')) {
        throw new Error(
          `Invalid sales project code: ${entry.projectCode || '(empty)'}`
        );
      }
      continue;
    }
    if (taskType === TASK_TYPE_INTERNAL_OPERATIONS) {
      if (!resolveOperationTaskName(operationTasks, entry.taskName || '')) {
        throw new Error(`Invalid operation task: ${entry.taskName || '(empty)'}`);
      }
      continue;
    }
    if (!taskMap.has(entry.taskId)) {
      throw new Error(`Invalid task ID: ${entry.taskId}`);
    }
    if (taskType === TASK_TYPE_INTERNAL_DEVELOPMENT) {
      const project = projectMap.get(entry.projectId);
      if (!project || !isShopstackClient(project.ProjectClient)) {
        throw new Error(
          `Invalid internal development project: ${entry.projectId}`
        );
      }
      continue;
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
          if (entryTaskType(entry) !== TASK_TYPE_PROJECT_DELIVERY) continue;
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
        const fields = resolveSubmitFields(entry, {
          projectMap,
          projectIdMap,
          taskMap,
          salesProjects,
          operationTasks,
        });
        const timeLogId = sheetsService.generateTimeLogId(
          parsed.data.date,
          ctx.staff.EmployeeID,
          fields.projectId,
          fields.taskId,
          fields.projectCode,
          fields.taskName
        );

        return {
          'Time Log ID': timeLogId,
          Date: parsed.data.date,
          'Staff ID': ctx.staff.EmployeeID,
          'Staff First Name': ctx.staff.FirstName,
          'Staff Last Name': ctx.staff.LastName,
          'Staff Position': ctx.staff.Position,
          'Project ID': fields.projectId,
          'Project Client': fields.projectClient,
          'Project Name': fields.projectName,
          'Project Code': fields.projectCode,
          'Task ID': fields.taskId,
          Task: fields.taskName,
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
        existingEntriesMap.set(syncKeyForRow(entry), { rowNumber, entry });
      });

      const submittedKeys = new Set(timeLogRows.map((row) => syncKeyForRow(row)));

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
            '[submitDayTimesheetForStaff] Delete after upsert failed; attempting full snapshot restore',
            deleteError
          );
          try {
            await restoreDayToSnapshot(
              sheetsService,
              parsed.data.date,
              ctx.staff.EmployeeID,
              snapshotRows
            );
          } catch (restoreError) {
            console.error(
              '[submitDayTimesheetForStaff] Compensating restore failed — day may be inconsistent',
              restoreError
            );
            const deleteMsg =
              deleteError instanceof Error ? deleteError.message : String(deleteError);
            const restoreMsg =
              restoreError instanceof Error ? restoreError.message : String(restoreError);
            throw new Error(
              `Write incomplete: delete failed (${deleteMsg}) and restore also failed (${restoreMsg}). Review the day in the web Timesheet before retrying.`
            );
          }
          throw new Error(
            'Could not finish updating the day; previous data was restored. Please retry.'
          );
        }
      }
    });
  } catch (error) {
    // Preserve typed lock identity for confirm / API mapping
    if (error instanceof SheetsWriteLockError) {
      throw error;
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

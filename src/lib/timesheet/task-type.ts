import { createHash } from 'crypto';
import type { SalesProject, TimeEntry, TimeLogRow, TimesheetTaskType } from '@/types';

export const TASK_TYPE_PROJECT_DELIVERY: TimesheetTaskType = 'project_delivery';
export const TASK_TYPE_SALES_PRESALES: TimesheetTaskType = 'sales_presales';
export const TASK_TYPE_INTERNAL_DEVELOPMENT: TimesheetTaskType =
  'internal_development';
export const TASK_TYPE_INTERNAL_OPERATIONS: TimesheetTaskType =
  'internal_operations';

export const SALES_TASK_NAME = 'Sales & Presales';
export const SHOPSTACK_CLIENT = 'Shopstack';
export const INTERNAL_OPERATIONS_PROJECT_NAME = 'Internal Operations';
export const INTERNAL_OPERATIONS_PROJECT_CODE = 'INTERNAL_OPERATIONS';
export const ZERO_MASTER_ID = '0';

export const SALES_PROJECTS_SHEET = 'Sales Projects';
export const DROPDOWN_SHEET = 'Dropdown';
export const OPERATION_TASK_HEADER = 'Operation Task';

export const TASK_TYPE_OPTIONS: Array<{ value: TimesheetTaskType; label: string }> =
  [
    { value: TASK_TYPE_PROJECT_DELIVERY, label: 'Project Delivery' },
    { value: TASK_TYPE_SALES_PRESALES, label: 'Sales & Presales' },
    { value: TASK_TYPE_INTERNAL_DEVELOPMENT, label: 'Internal Development' },
    { value: TASK_TYPE_INTERNAL_OPERATIONS, label: 'Internal Operations' },
  ];

export class DuplicateSalesProjectCodeError extends Error {
  constructor(code: string) {
    super(`Project code already exists: ${code}`);
    this.name = 'DuplicateSalesProjectCodeError';
  }
}

export function isShopstackClient(client: string | undefined | null): boolean {
  return (client || '').trim().toLowerCase() === SHOPSTACK_CLIENT.toLowerCase();
}

/** Project Delivery client list hides Shopstack, *New, and *Other. */
export function isProjectDeliveryClient(client: string | undefined | null): boolean {
  const key = (client || '').trim().toLowerCase();
  if (!key || key === 'shopstack' || key === '*new' || key === '*other') {
    return false;
  }
  return true;
}

export function normalizeProjectCode(code: string | undefined | null): string {
  return (code || '').trim().toLowerCase();
}

export function sameLabel(a: string | undefined | null, b: string | undefined | null): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

/** True when this code is already used on Sales Projects (trim, case-insensitive). */
export function salesProjectCodeTaken(
  existingCodes: Array<string | undefined | null>,
  code: string
): boolean {
  const key = normalizeProjectCode(code);
  if (!key) return false;
  return existingCodes.some((existing) => normalizeProjectCode(existing) === key);
}

export function findSalesProject(
  projects: SalesProject[],
  projectCode: string
): SalesProject | undefined {
  const key = normalizeProjectCode(projectCode);
  if (!key) return undefined;
  return projects.find((project) => normalizeProjectCode(project.ProjectCode) === key);
}

/** Return the sheet's spelling when the name matches (trim, case-insensitive). */
export function resolveOperationTaskName(
  tasks: string[],
  taskName: string
): string | undefined {
  const key = taskName.trim().toLowerCase();
  if (!key) return undefined;
  return tasks.find((task) => task.trim().toLowerCase() === key);
}

export type TimeLogIdentity = {
  projectId: string;
  taskId: string;
  projectCode?: string;
  taskName?: string;
};

/**
 * Day-sync key. Real master IDs stay `projectId|taskId`.
 * Rows written with Project ID 0 and Task ID 0 also include Project Code and Task
 * so two sales projects, or two operation tasks, do not collapse into one row.
 */
export function timeLogSyncKey(row: TimeLogIdentity): string {
  const projectId = String(row.projectId ?? '');
  const taskId = String(row.taskId ?? '');
  if (projectId === ZERO_MASTER_ID && taskId === ZERO_MASTER_ID) {
    return `${ZERO_MASTER_ID}|${ZERO_MASTER_ID}|${(row.projectCode || '').trim()}|${(row.taskName || '').trim()}`;
  }
  return `${projectId}|${taskId}`;
}

/**
 * Time Log ID material. Non-zero project/task IDs keep the historical
 * `date|staff|project|task` hash. Zero IDs add project code and task name.
 */
export function buildTimeLogId(
  date: string,
  staffId: string,
  projectId: string,
  taskId: string,
  projectCode?: string,
  taskName?: string
): string {
  const pid = String(projectId);
  const tid = String(taskId);
  let combined = `${date}|${staffId}|${pid}|${tid}`;
  if (pid === ZERO_MASTER_ID && tid === ZERO_MASTER_ID) {
    combined += `|${(projectCode || '').trim()}|${(taskName || '').trim()}`;
  }
  return createHash('sha256').update(combined).digest('hex').substring(0, 16);
}

export function timeLogRowIdentity(entry: TimeLogRow): string {
  if (entry['Time Log ID']) return entry['Time Log ID'];
  return `existing-${entry.Date}-${timeLogSyncKey({
    projectId: entry['Project ID'],
    taskId: entry['Task ID'],
    projectCode: entry['Project Code'],
    taskName: entry.Task,
  })}`;
}

export function inferTaskType(row: TimeLogRow): TimesheetTaskType {
  const projectId = String(row['Project ID'] ?? '').trim();
  const taskId = String(row['Task ID'] ?? '').trim();
  const taskName = String(row.Task ?? '').trim();
  const projectCode = String(row['Project Code'] ?? '').trim();
  const client = String(row['Project Client'] ?? '').trim();
  const zeroIds = projectId === ZERO_MASTER_ID && taskId === ZERO_MASTER_ID;

  if (zeroIds && taskName === SALES_TASK_NAME) {
    return TASK_TYPE_SALES_PRESALES;
  }
  if (zeroIds && projectCode === INTERNAL_OPERATIONS_PROJECT_CODE) {
    return TASK_TYPE_INTERNAL_OPERATIONS;
  }
  if (
    isShopstackClient(client) &&
    projectId !== '' &&
    projectId !== ZERO_MASTER_ID
  ) {
    return TASK_TYPE_INTERNAL_DEVELOPMENT;
  }
  return TASK_TYPE_PROJECT_DELIVERY;
}

export function timeLogRowToTimeEntry(entry: TimeLogRow): TimeEntry {
  const taskType = inferTaskType(entry);
  return {
    id: timeLogRowIdentity(entry),
    taskType,
    projectId: entry['Project ID'],
    taskId: entry['Task ID'],
    hours: entry.Hours,
    projectClient: entry['Project Client'],
    projectName: entry['Project Name'],
    projectCode: entry['Project Code'],
    taskName: entry.Task,
  };
}

export type ResolvedTimeLogFields = {
  projectId: string;
  projectClient: string;
  projectName: string;
  projectCode: string;
  taskId: string;
  taskName: string;
};

export function salesTimeLogFields(project: SalesProject): ResolvedTimeLogFields {
  return {
    projectId: ZERO_MASTER_ID,
    projectClient: project.ProjectClient,
    projectName: project.ProjectName,
    projectCode: project.ProjectCode,
    taskId: ZERO_MASTER_ID,
    taskName: SALES_TASK_NAME,
  };
}

export function operationTimeLogFields(taskName: string): ResolvedTimeLogFields {
  return {
    projectId: ZERO_MASTER_ID,
    projectClient: SHOPSTACK_CLIENT,
    projectName: INTERNAL_OPERATIONS_PROJECT_NAME,
    projectCode: INTERNAL_OPERATIONS_PROJECT_CODE,
    taskId: ZERO_MASTER_ID,
    taskName,
  };
}

export function isTimeEntryReady(entry: {
  taskType?: TimesheetTaskType;
  projectId?: string;
  taskId?: string;
  hours: number;
  projectClient?: string;
  projectCode?: string;
  taskName?: string;
}): boolean {
  if (!(entry.hours > 0)) return false;
  const taskType = entry.taskType ?? TASK_TYPE_PROJECT_DELIVERY;
  if (
    taskType === TASK_TYPE_PROJECT_DELIVERY ||
    taskType === TASK_TYPE_INTERNAL_DEVELOPMENT
  ) {
    return Boolean(entry.projectId?.trim() && entry.taskId?.trim());
  }
  if (taskType === TASK_TYPE_SALES_PRESALES) {
    return Boolean(entry.projectClient?.trim() && entry.projectCode?.trim());
  }
  if (taskType === TASK_TYPE_INTERNAL_OPERATIONS) {
    return Boolean(entry.taskName?.trim());
  }
  return false;
}

export type SubmitEntryPayload = {
  taskType: TimesheetTaskType;
  projectId: string;
  taskId: string;
  hours: number;
  projectClient?: string;
  projectName?: string;
  projectCode?: string;
  taskName?: string;
};

export function toSubmitEntryPayload(entry: TimeEntry): SubmitEntryPayload {
  const taskType = entry.taskType ?? TASK_TYPE_PROJECT_DELIVERY;
  if (
    taskType === TASK_TYPE_SALES_PRESALES ||
    taskType === TASK_TYPE_INTERNAL_OPERATIONS
  ) {
    return {
      taskType,
      projectId: ZERO_MASTER_ID,
      taskId: ZERO_MASTER_ID,
      hours: entry.hours,
      projectClient: entry.projectClient,
      projectName: entry.projectName,
      projectCode: entry.projectCode,
      taskName: entry.taskName,
    };
  }
  return {
    taskType,
    projectId: entry.projectId,
    taskId: entry.taskId,
    hours: entry.hours,
  };
}

/**
 * Read the Operation Task column from a Dropdown sheet values grid (row 1 = headers).
 */
export function operationTaskNamesFromDropdownRows(rows: unknown[][]): string[] {
  const headerRow = rows[0] || [];
  const headerIndex = headerRow.findIndex(
    (cell) =>
      String(cell ?? '')
        .trim()
        .toLowerCase() === OPERATION_TASK_HEADER.toLowerCase()
  );
  if (headerIndex < 0) {
    throw new Error(
      `Dropdown sheet is missing an "${OPERATION_TASK_HEADER}" column`
    );
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i]?.[headerIndex] ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function uniqueSortedClients(clients: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const client of clients) {
    const trimmed = client.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, trimmed);
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
}

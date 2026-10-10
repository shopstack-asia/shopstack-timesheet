import {
  INTERNAL_OPERATIONS_PROJECT_CODE,
  TASK_TYPE_INTERNAL_OPERATIONS,
  TASK_TYPE_PROJECT_DELIVERY,
  TASK_TYPE_SALES_PRESALES,
  ZERO_MASTER_ID,
} from '@/lib/timesheet/task-type';
import type { TimesheetTaskType } from '@/types';
import type { WorkContextRef } from '@/types/shared/work-context';

export type WorkContextSource = {
  taskType?: TimesheetTaskType;
  projectId?: string;
  projectCode?: string;
  projectName?: string;
  projectClient?: string;
  taskId?: string;
  taskName?: string;
};

function trimmed(value: string | undefined): string | undefined {
  const next = (value ?? '').trim();
  return next || undefined;
}

function definedFields(ref: WorkContextRef): WorkContextRef {
  return Object.fromEntries(
    Object.entries(ref).filter(([, value]) => value !== undefined)
  ) as WorkContextRef;
}

/** Drop blank and zero master ids. Those are placeholders, not ProjectID references. */
function optionalMasterId(value: string | undefined): string | undefined {
  const next = trimmed(value);
  if (!next || next === ZERO_MASTER_ID) return undefined;
  return next;
}

/**
 * Map a timesheet entry shape onto an optional work-context reference.
 * This does not write the Time Log and does not require a ProjectID.
 */
export function toWorkContextRef(source: WorkContextSource): WorkContextRef {
  const kind = source.taskType ?? TASK_TYPE_PROJECT_DELIVERY;
  const projectCode = trimmed(source.projectCode);
  const projectName = trimmed(source.projectName);
  const projectClient = trimmed(source.projectClient);
  const taskName = trimmed(source.taskName);

  if (kind === TASK_TYPE_SALES_PRESALES) {
    return definedFields({
      kind,
      projectCode,
      projectName,
      projectClient,
      taskName,
    });
  }

  if (kind === TASK_TYPE_INTERNAL_OPERATIONS) {
    return definedFields({
      kind,
      projectCode: projectCode || INTERNAL_OPERATIONS_PROJECT_CODE,
      projectName,
      projectClient,
      taskName,
    });
  }

  return definedFields({
    kind,
    projectId: optionalMasterId(source.projectId),
    projectCode,
    projectName,
    projectClient,
    taskId: optionalMasterId(source.taskId),
    taskName,
  });
}

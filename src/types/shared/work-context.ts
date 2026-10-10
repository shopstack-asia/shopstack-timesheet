/**
 * Optional work-context reference shared by future modules.
 * Project ID is optional: Sales Projects use ProjectCode, and Internal Operations
 * uses the INTERNAL_OPERATIONS code with a zero master id on the Time Log.
 */
export type WorkContextKind =
  | 'project_delivery'
  | 'sales_presales'
  | 'internal_development'
  | 'internal_operations'
  | 'unspecified';

export type WorkContextRef = {
  kind: WorkContextKind;
  projectId?: string;
  projectCode?: string;
  projectName?: string;
  projectClient?: string;
  taskId?: string;
  taskName?: string;
};

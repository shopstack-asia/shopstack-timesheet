export const WORKSPACE_ROUTES = {
  home: '/',
  signIn: '/auth/signin',
  dashboard: '/dashboard',
  timesheet: '/timesheet',
  expense: '/expense',
  expenseRequests: '/expense/requests',
  expenseRequestNew: '/expense/requests/new',
  expenseMine: '/expense/mine',
  expenseNew: '/expense/new',
  expenseMyClaims: '/expense/claims',
  expenseManagement: '/expense/management',
  expenseManagementExpenses: '/expense/management/expenses',
  expenseManagementSummary: '/expense/management/summary',
  expenseManagementSummaryPreview: '/expense/management/summary/preview',
  expenseManagementClaims: '/expense/management/claims',
  expenseManagementCategories: '/expense/management/categories',
  settings: '/settings',
  settingsRoles: '/settings/roles',
} as const;

/**
 * Authenticated `/` stays on My Timesheet.
 * Dashboard is available from navigation and does not replace the existing landing page.
 */
export const AUTHENTICATED_HOME = WORKSPACE_ROUTES.timesheet;

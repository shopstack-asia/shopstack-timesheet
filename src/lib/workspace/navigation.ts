import {
  hasWorkspaceRole,
  type WorkspaceRole,
} from '@/lib/workspace/authorization';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export type WorkspaceNavLink = {
  id: string;
  label: string;
  href: string;
  roles?: readonly WorkspaceRole[];
};

export type WorkspaceNavEntry = {
  id: string;
  label: string;
  href?: string;
  roles?: readonly WorkspaceRole[];
  children?: readonly WorkspaceNavLink[];
};

export const WORKSPACE_NAVIGATION: readonly WorkspaceNavEntry[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: WORKSPACE_ROUTES.dashboard,
  },
  {
    id: 'timesheet',
    label: 'Timesheet',
    children: [
      {
        id: 'my-timesheet',
        label: 'My Timesheet',
        href: WORKSPACE_ROUTES.timesheet,
      },
    ],
  },
  {
    id: 'expense',
    label: 'Expense',
    children: [
      {
        id: 'my-expenses',
        label: 'My Expenses',
        href: WORKSPACE_ROUTES.expenseMine,
      },
      {
        id: 'my-monthly-claims',
        label: 'My Monthly Claims',
        href: WORKSPACE_ROUTES.expenseMyClaims,
      },
    ],
  },
  {
    id: 'expense-management',
    label: 'Expense Management',
    roles: ['HR', 'ADMIN'],
    children: [
      {
        id: 'all-expenses',
        label: 'All Expenses',
        href: WORKSPACE_ROUTES.expenseManagementExpenses,
      },
      {
        id: 'monthly-summary',
        label: 'Monthly Summary',
        href: WORKSPACE_ROUTES.expenseManagementSummary,
      },
      {
        id: 'expense-claims',
        label: 'Expense Claims',
        href: WORKSPACE_ROUTES.expenseManagementClaims,
      },
      {
        id: 'manage-category',
        label: 'Manage Category',
        href: WORKSPACE_ROUTES.expenseManagementCategories,
      },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    roles: ['ADMIN'],
    children: [
      {
        id: 'roles-permission',
        label: 'Roles & Permission',
        href: WORKSPACE_ROUTES.settingsRoles,
        roles: ['ADMIN'],
      },
    ],
  },
];

export function visibleNavigation(
  roles: readonly WorkspaceRole[],
  entries: readonly WorkspaceNavEntry[] = WORKSPACE_NAVIGATION
): WorkspaceNavEntry[] {
  return entries.flatMap((entry) => {
    if (entry.roles && !hasWorkspaceRole(roles, entry.roles)) {
      return [];
    }
    if (!entry.children) {
      return [entry];
    }
    const children = entry.children.filter(
      (child) => !child.roles || hasWorkspaceRole(roles, child.roles)
    );
    if (children.length === 0 && !entry.href) {
      return [];
    }
    return [{ ...entry, children }];
  });
}

export function activeNavigationHref(
  pathname: string,
  entries: readonly WorkspaceNavEntry[]
): string | null {
  const hrefs: string[] = [];
  for (const entry of entries) {
    if (entry.href) hrefs.push(entry.href);
    for (const child of entry.children ?? []) {
      hrefs.push(child.href);
    }
  }

  const matches = hrefs.filter(
    (href) => pathname === href || pathname.startsWith(`${href}/`)
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, href) => (href.length > best.length ? href : best));
}

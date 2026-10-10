import { describe, expect, it } from 'vitest';
import {
  activeNavigationHref,
  visibleNavigation,
  WORKSPACE_NAVIGATION,
} from '@/lib/workspace/navigation';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

function labels(roles: Parameters<typeof visibleNavigation>[0]): string[] {
  return visibleNavigation(roles).flatMap((entry) => [
    entry.label,
    ...(entry.children ?? []).map((child) => child.label),
  ]);
}

describe('workspace navigation configuration', () => {
  it('lists Dashboard, Timesheet, and Expense for employees', () => {
    expect(labels(['EMPLOYEE'])).toEqual([
      'Dashboard',
      'Timesheet',
      'My Timesheet',
      'Expense',
      'My Expenses',
      'My Monthly Claims',
    ]);
    expect(labels(['EMPLOYEE'])).not.toContain('Expense Management');
    expect(labels(['EMPLOYEE'])).not.toContain('Settings');
  });

  it('shows Expense Management to HR and Settings only to Admin', () => {
    expect(labels(['HR'])).toContain('Expense Management');
    expect(labels(['HR'])).toContain('All Expenses');
    expect(labels(['HR'])).not.toContain('Settings');
    expect(labels(['ADMIN'])).toEqual([
      'Dashboard',
      'Timesheet',
      'My Timesheet',
      'Expense',
      'My Expenses',
      'My Monthly Claims',
      'Expense Management',
      'All Expenses',
      'Monthly Summary',
      'Expense Claims',
      'Manage Category',
      'Settings',
      'Roles & Permission',
    ]);
  });

  it('keeps My Timesheet on the existing /timesheet path', () => {
    const timesheet = WORKSPACE_NAVIGATION.find((entry) => entry.id === 'timesheet');
    expect(timesheet?.children?.[0]?.href).toBe(WORKSPACE_ROUTES.timesheet);
    expect(WORKSPACE_ROUTES.timesheet).toBe('/timesheet');
  });
});

describe('active navigation', () => {
  it('highlights the longest matching route', () => {
    const entries = visibleNavigation(['ADMIN']);
    expect(activeNavigationHref('/timesheet', entries)).toBe('/timesheet');
    expect(activeNavigationHref('/expense/mine', entries)).toBe('/expense/mine');
    expect(activeNavigationHref('/expense/new', entries)).toBeNull();
    expect(activeNavigationHref('/expense/management/claims/claim-1', entries)).toBe(
      '/expense/management/claims'
    );
    expect(activeNavigationHref('/dashboard', entries)).toBe('/dashboard');
    expect(activeNavigationHref('/unknown', entries)).toBeNull();
  });
});

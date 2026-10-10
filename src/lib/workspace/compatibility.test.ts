import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { authOptions } from '@/lib/auth';
import { APP_NAME } from '@/lib/workspace/branding';
import { AUTHENTICATED_HOME, WORKSPACE_ROUTES } from '@/lib/workspace/routes';
import { TASK_TYPE_OPTIONS } from '@/lib/timesheet/task-type';

const root = process.cwd();

function source(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

describe('route compatibility', () => {
  it('keeps authenticated home on My Timesheet', () => {
    expect(AUTHENTICATED_HOME).toBe('/timesheet');
    expect(source('src/app/page.tsx')).toContain('AUTHENTICATED_HOME');
  });

  it('protects existing APIs and the new workspace pages in middleware', () => {
    const middleware = source('src/middleware.ts');
    for (const matcher of [
      '/timesheet/:path*',
      '/dashboard/:path*',
      '/expense/:path*',
      '/settings/:path*',
      '/api/timesheet/:path*',
      '/api/master/:path*',
      '/api/staff/:path*',
      '/api/expense/:path*',
      '/api/workspace/:path*',
      '/api/settings/:path*',
    ]) {
      expect(middleware).toContain(matcher);
    }
    expect(middleware).not.toContain('/api/cron');
    expect(middleware).not.toContain('/api/debug');
  });

  it('keeps timesheet API route files in place', () => {
    expect(source('src/app/api/timesheet/get/route.ts')).toContain('getServerSession');
    expect(source('src/app/api/timesheet/submit/route.ts')).toContain('project_delivery');
    expect(source('src/app/api/timesheet/submit/route.ts')).toContain('sales_presales');
    expect(source('src/app/api/timesheet/submit/route.ts')).toContain('internal_development');
    expect(source('src/app/api/timesheet/submit/route.ts')).toContain('internal_operations');
    expect(source('src/app/api/timesheet/holidays/route.ts')).toContain('export async function GET');
  });

  it('serves expense pages from the workspace route group without changing public paths', () => {
    expect(WORKSPACE_ROUTES.expenseRequests).toBe('/expense/requests');
    expect(WORKSPACE_ROUTES.expenseRequestNew).toBe('/expense/requests/new');
    expect(WORKSPACE_ROUTES.expenseManagement).toBe('/expense/management');
    expect(source('src/app/(workspace)/timesheet/page.tsx')).toContain('WeeklyTimesheet');
    expect(source('src/app/(workspace)/expense/page.tsx')).toContain('expenseMine');
  });
});

describe('authentication preservation', () => {
  it('keeps Google SSO, the JWT session, and the existing sign-in page', () => {
    expect(authOptions.providers.map((provider) => provider.id)).toContain('google');
    expect(authOptions.session?.strategy).toBe('jwt');
    expect(authOptions.pages?.signIn).toBe('/auth/signin');
    expect(authOptions.pages?.error).toBe('/auth/error');
  });
});

describe('timesheet task type compatibility', () => {
  it('keeps all four task types', () => {
    expect(TASK_TYPE_OPTIONS.map((option) => option.value)).toEqual([
      'project_delivery',
      'sales_presales',
      'internal_development',
      'internal_operations',
    ]);
  });
});

describe('application branding', () => {
  it('uses ShopStack Workspace as the application name', () => {
    expect(APP_NAME).toBe('ShopStack Workspace');
    expect(source('src/app/layout.tsx')).toContain('APP_NAME');
    expect(source('src/app/auth/signin/page.tsx')).toContain('APP_NAME');
  });
});

describe('expense management server gate', () => {
  it('keeps the API authorization gate while the page opens the local demo', () => {
    const page = source('src/app/(workspace)/expense/management/page.tsx');
    const route = source('src/app/api/expense/management/route.ts');
    expect(page).toContain('expenseManagementSummary');
    expect(route).toContain('authorizeExpenseManagement');
    expect(route).toContain('getServerSession');
    expect(route).not.toContain('google-sheets');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceShell } from '@/components/workspace/layout/WorkspaceShell';
import { APP_NAME } from '@/lib/workspace/branding';
import { visibleNavigation } from '@/lib/workspace/navigation';
import type { WorkspaceRole } from '@/lib/workspace/authorization';

function renderShell(pathname: string, roles: readonly WorkspaceRole[], menuOpen = false) {
  return renderToStaticMarkup(
    <WorkspaceShell
      appName={APP_NAME}
      userLabel="Ada Lovelace"
      theme="light"
      pathname={pathname}
      navigation={visibleNavigation(roles)}
      menuOpen={menuOpen}
      onToggleMenu={() => undefined}
      onToggleTheme={() => undefined}
      onSignOut={() => undefined}
    >
      <p>Page body</p>
    </WorkspaceShell>
  );
}

describe('workspace layout rendering', () => {
  it('renders branding, the signed-in user, and employee navigation', () => {
    const html = renderShell('/timesheet', ['EMPLOYEE'], true);
    expect(html).toContain('ShopStack Workspace');
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('My Timesheet');
    expect(html).toContain('My Expenses');
    expect(html).not.toContain('Add Expense');
    expect(html).not.toContain('Expense Management');
    expect(html).not.toContain('Roles & Permission');
    expect(html).toContain('Sign Out');
    expect(html).toContain('Page body');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/timesheet"');
  });

  it('marks the mobile menu state and shows Expense Management for HR', () => {
    const closed = renderShell('/dashboard', ['HR'], false);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('Menu');
    const open = renderShell('/expense/management', ['HR'], true);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('Expense Management');
    expect(open).toContain('href="/expense/management/summary"');
    expect(open).not.toContain('Roles & Permission');
  });

  it('shows Settings for an administrator', () => {
    const html = renderShell('/settings/roles', ['ADMIN'], true);
    expect(html).toContain('Roles &amp; Permission');
    expect(html).toContain('href="/settings/roles"');
    expect(html).toContain('Expense Management');
  });
});

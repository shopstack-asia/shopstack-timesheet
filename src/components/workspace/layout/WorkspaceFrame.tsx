'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import { WorkspaceShell } from '@/components/workspace/layout/WorkspaceShell';
import { useTheme } from '@/contexts/ThemeContext';
import type { WorkspaceRole } from '@/lib/workspace/authorization';
import { APP_NAME } from '@/lib/workspace/branding';
import { visibleNavigation } from '@/lib/workspace/navigation';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';
import type { ApiResponse } from '@/types';

const WorkspaceAccessContext = createContext<{
  roles: readonly WorkspaceRole[];
  refresh: () => Promise<void>;
}>({
  roles: ['EMPLOYEE'],
  refresh: async () => undefined,
});

export function useWorkspaceAccess() {
  return useContext(WorkspaceAccessContext);
}

export function WorkspaceFrame({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname() || '/';
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [roles, setRoles] = useState<WorkspaceRole[]>(['EMPLOYEE']);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/workspace/access');
    const body = (await response.json()) as ApiResponse<{ roles: WorkspaceRole[] }>;
    if (response.ok && body.success && body.data) {
      setRoles(body.data.roles);
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    refresh().catch(() => {
      if (!cancelled) setRoles(['EMPLOYEE']);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh, status]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push(WORKSPACE_ROUTES.signIn);
    }
  }, [status, router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-lg text-gray-900 dark:text-white">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated' || !session) {
    return null;
  }

  const userLabel = session.staffProfile
    ? `${session.staffProfile.FirstName} ${session.staffProfile.LastName}`.trim()
    : session.user?.name || session.user?.email || '';

  return (
    <WorkspaceAccessContext.Provider value={{ roles, refresh }}>
    <WorkspaceShell
      appName={APP_NAME}
      userLabel={userLabel}
      theme={theme}
      pathname={pathname}
      navigation={visibleNavigation(roles)}
      menuOpen={menuOpen}
      onToggleMenu={() => setMenuOpen((open) => !open)}
      onToggleTheme={toggleTheme}
      onSignOut={() => signOut({ callbackUrl: WORKSPACE_ROUTES.signIn })}
    >
      {children}
    </WorkspaceShell>
    </WorkspaceAccessContext.Provider>
  );
}

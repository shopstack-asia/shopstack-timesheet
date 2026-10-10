'use client';

import Link from 'next/link';
import {
  activeNavigationHref,
  type WorkspaceNavEntry,
} from '@/lib/workspace/navigation';

type WorkspaceShellProps = {
  appName: string;
  userLabel: string;
  theme: 'light' | 'dark';
  pathname: string;
  navigation: readonly WorkspaceNavEntry[];
  menuOpen: boolean;
  onToggleMenu: () => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
  children: React.ReactNode;
};

function linkClass(active: boolean): string {
  return active
    ? 'block rounded-md px-3 py-2 text-sm font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
    : 'block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700';
}

export function WorkspaceShell({
  appName,
  userLabel,
  theme,
  pathname,
  navigation,
  menuOpen,
  onToggleMenu,
  onToggleTheme,
  onSignOut,
  children,
}: WorkspaceShellProps) {
  const activeHref = activeNavigationHref(pathname, navigation);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onToggleMenu}
              aria-expanded={menuOpen}
              aria-controls="workspace-nav"
              className="md:hidden p-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
            >
              {menuOpen ? 'Close' : 'Menu'}
            </button>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate">
              {appName}
            </h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {userLabel ? (
              <span className="text-sm text-gray-600 dark:text-gray-300 truncate max-w-[7rem] sm:max-w-xs">
                {userLabel}
              </span>
            ) : null}
            <button
              type="button"
              onClick={onToggleTheme}
              className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="md:flex">
        <aside
          id="workspace-nav"
          className={`${menuOpen ? 'block' : 'hidden'} md:block w-full md:w-64 shrink-0 bg-white dark:bg-gray-800 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700`}
        >
          <nav aria-label="Main" className="p-3 space-y-4">
            {navigation.map((entry) => {
              if (entry.href && !entry.children?.length) {
                const active = entry.href === activeHref;
                return (
                  <Link
                    key={entry.id}
                    href={entry.href}
                    aria-current={active ? 'page' : undefined}
                    className={linkClass(active)}
                  >
                    {entry.label}
                  </Link>
                );
              }

              return (
                <div key={entry.id}>
                  <p className="px-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {entry.label}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {(entry.children ?? []).map((child) => {
                      const active = child.href === activeHref;
                      return (
                        <li key={child.id}>
                          <Link
                            href={child.href}
                            aria-current={active ? 'page' : undefined}
                            className={linkClass(active)}
                          >
                            {child.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>
        </aside>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

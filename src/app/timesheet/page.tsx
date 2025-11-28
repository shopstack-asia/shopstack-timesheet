'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { format, startOfWeek, addWeeks, subWeeks } from 'date-fns';
import WeeklyTimesheet from '@/components/WeeklyTimesheet';
import { useTheme } from '@/contexts/ThemeContext';
import { Suspense } from 'react';

type ViewMode = 'column' | 'tab';

export default function TimesheetPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('column');
  const [viewModeInitialized, setViewModeInitialized] = useState(false);

  // Load saved view mode preference
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const savedViewMode = localStorage.getItem('timesheetViewMode') as ViewMode | null;
    if (savedViewMode === 'column' || savedViewMode === 'tab') {
      setViewMode(savedViewMode);
    }
    setViewModeInitialized(true);
  }, []);

  // Persist view mode preference
  useEffect(() => {
    if (!viewModeInitialized || typeof window === 'undefined') {
      return;
    }
    localStorage.setItem('timesheetViewMode', viewMode);
  }, [viewMode, viewModeInitialized]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    }
  }, [status, router]);

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

  const handlePreviousWeek = () => {
    setCurrentWeek(subWeeks(currentWeek, 1));
  };

  const handleNextWeek = () => {
    setCurrentWeek(addWeeks(currentWeek, 1));
  };

  const handleCurrentWeek = () => {
    setCurrentWeek(new Date());
  };

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Shopstack Timesheet</h1>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              {session.staffProfile && (
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  {session.staffProfile.FirstName} {session.staffProfile.LastName}
                </span>
              )}
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => signOut({ callbackUrl: '/auth/signin' })}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white text-left sm:text-center"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-6">
        <div className="mb-6">
          {/* Week Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
              <button
                onClick={handlePreviousWeek}
                className="px-3 sm:px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm sm:text-base whitespace-nowrap"
              >
                ← Previous
              </button>
              <button
                onClick={handleCurrentWeek}
                className="px-3 sm:px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm sm:text-base whitespace-nowrap"
              >
                Current Week
              </button>
              <button
                onClick={handleNextWeek}
                className="px-3 sm:px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm sm:text-base whitespace-nowrap"
              >
                Next →
              </button>
            </div>
            <div className="text-base sm:text-lg font-semibold text-gray-700 dark:text-gray-300 text-center sm:text-right">
              {format(weekStart, 'MMM d')} - {format(addWeeks(weekStart, 1).getTime() - 1, 'MMM d, yyyy')}
            </div>
          </div>
        </div>

        <WeeklyTimesheet weekStart={weekStart} viewMode={viewMode} onViewModeChange={setViewMode} />
      </div>
    </div>
  );
}


'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { format, startOfWeek, addWeeks, subWeeks } from 'date-fns';
import WeeklyTimesheet from '@/components/WeeklyTimesheet';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

type ViewMode = 'column' | 'tab';

export default function TimesheetPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('tab');
  const [viewModeInitialized, setViewModeInitialized] = useState(false);

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

  useEffect(() => {
    if (!viewModeInitialized || typeof window === 'undefined') {
      return;
    }
    localStorage.setItem('timesheetViewMode', viewMode);
  }, [viewMode, viewModeInitialized]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push(WORKSPACE_ROUTES.signIn);
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="container mx-auto px-4 py-6 text-lg text-gray-900 dark:text-white">
        Loading...
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
    <div className="container mx-auto px-4 py-6">
      <div className="mb-6">
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
  );
}

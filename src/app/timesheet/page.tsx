'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { format, startOfWeek, addWeeks, subWeeks } from 'date-fns';
import WeeklyTimesheet from '@/components/WeeklyTimesheet';
import {
  storeYearlyLeaveData,
} from '@/lib/leave-storage';

export default function TimesheetPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const leaveDataLoadedRef = useRef<Set<number>>(new Set());

  // Load yearly leave data fresh from API after login and overwrite localStorage
  useEffect(() => {
    if (status !== 'authenticated' || !session?.staffProfile?.EmployeeID) {
      return;
    }

    const employeeId = session.staffProfile.EmployeeID;
    const currentYear = new Date().getFullYear();
    const yearsToLoad = [currentYear, currentYear + 1]; // Current year and next year

    // Check if we already loaded for this session
    const allLoaded = yearsToLoad.every((year) => leaveDataLoadedRef.current.has(year));
    if (allLoaded) {
      return; // Already loaded in this session
    }

    const loadYearlyLeaveData = async () => {
      try {
        // Mark years as loading to prevent duplicate requests
        yearsToLoad.forEach((year) => leaveDataLoadedRef.current.add(year));

        // Always fetch fresh data from API and overwrite localStorage
        await Promise.all(
          yearsToLoad.map(async (year) => {
            const response = await fetch(`/api/staff/leave/yearly?year=${year}`);

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(errorText || `Failed to load yearly leave data for ${year}`);
            }

            const payload = await response.json();
            if (!payload.success) {
              throw new Error(payload.error || `Failed to load yearly leave data for ${year}`);
            }

            const data = payload.data || [];
            // Always overwrite localStorage with fresh data
            console.log('[TimesheetPage] Storing yearly leave data for year', year, data);
            storeYearlyLeaveData(employeeId, year, data);
          })
        );
      } catch (error) {
        console.error('[TimesheetPage] Error loading yearly leave data:', error);
        // Remove failed years from loading set to allow retry
        yearsToLoad.forEach((year) => leaveDataLoadedRef.current.delete(year));
      }
    };

    loadYearlyLeaveData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session?.staffProfile?.EmployeeID]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
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
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Shopstack Timesheet</h1>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              {session.staffProfile && (
                <span className="text-sm text-gray-600">
                  {session.staffProfile.FirstName} {session.staffProfile.LastName}
                </span>
              )}
              <button
                onClick={() => signOut({ callbackUrl: '/auth/signin' })}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900 text-left sm:text-center"
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
                className="px-3 sm:px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50 text-sm sm:text-base whitespace-nowrap"
              >
                ← Previous
              </button>
              <button
                onClick={handleCurrentWeek}
                className="px-3 sm:px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50 text-sm sm:text-base whitespace-nowrap"
              >
                Current Week
              </button>
              <button
                onClick={handleNextWeek}
                className="px-3 sm:px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50 text-sm sm:text-base whitespace-nowrap"
              >
                Next →
              </button>
            </div>
            <div className="text-base sm:text-lg font-semibold text-gray-700 text-center sm:text-right">
              {format(weekStart, 'MMM d')} - {format(addWeeks(weekStart, 1).getTime() - 1, 'MMM d, yyyy')}
            </div>
          </div>
        </div>

        <WeeklyTimesheet weekStart={weekStart} />
      </div>
    </div>
  );
}


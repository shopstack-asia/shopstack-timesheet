'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { format, startOfWeek, addWeeks, subWeeks } from 'date-fns';
import WeeklyTimesheet from '@/components/WeeklyTimesheet';

export default function TimesheetPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [currentWeek, setCurrentWeek] = useState(new Date());

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
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-900">Shopstack Timesheet</h1>
          <div className="flex items-center gap-4">
            {session.staffProfile && (
              <span className="text-sm text-gray-600">
                {session.staffProfile.FirstName} {session.staffProfile.LastName}
              </span>
            )}
            <button
              onClick={() => signOut({ callbackUrl: '/auth/signin' })}
              className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
            >
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handlePreviousWeek}
              className="px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50"
            >
              ← Previous
            </button>
            <button
              onClick={handleCurrentWeek}
              className="px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50"
            >
              Current Week
            </button>
            <button
              onClick={handleNextWeek}
              className="px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50"
            >
              Next →
            </button>
          </div>
          <div className="text-lg font-semibold text-gray-700">
            {format(weekStart, 'MMM d')} - {format(addWeeks(weekStart, 1).getTime() - 1, 'MMM d, yyyy')}
          </div>
        </div>

        <WeeklyTimesheet weekStart={weekStart} />
      </div>
    </div>
  );
}


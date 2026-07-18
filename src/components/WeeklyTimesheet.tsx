'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { format, startOfWeek, addDays, parseISO } from 'date-fns';
import DailyCard from './DailyCard';
import { Project, Task, TimeEntry, DailyTimesheet, LeaveDayEntry, Holiday } from '@/types';
import { getLeaveEntry, isFullLeave, isHalfLeave } from '@/lib/leave-utils';
import { submitWeekDaysSequentially } from '@/lib/submit-week-days';

type ViewMode = 'column' | 'tab';

interface WeeklyTimesheetProps {
  weekStart: Date;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

const DEFAULT_HOLIDAY_LOCATION =
  process.env.NEXT_PUBLIC_ZOHO_HOLIDAY_LOCATION ||
  process.env.NEXT_PUBLIC_DEFAULT_LOCATION ||
  '';

export default function WeeklyTimesheet({ weekStart, viewMode, onViewModeChange }: WeeklyTimesheetProps) {
  const { data: session } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<string[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timesheet, setTimesheet] = useState<DailyTimesheet[]>([]);
  const [leaveData, setLeaveData] = useState<LeaveDayEntry[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(0);
  const loadedWeekRef = useRef<string | null>(null);
  const timesheetInitializedRef = useRef<boolean>(false);
  const holidayCacheRef = useRef<Record<string, Holiday[]>>({});
  const leaveDataCacheRef = useRef<Map<string, LeaveDayEntry[]>>(new Map());

  // Initialize days of the week (Monday–Sunday)
  useEffect(() => {
    const monday = startOfWeek(weekStart, { weekStartsOn: 1 });
    
    // Reset loaded week ref when week changes to force reload
    loadedWeekRef.current = null;
    
    const days: DailyTimesheet[] = [];

    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      days.push({
        date: format(date, 'yyyy-MM-dd'),
        entries: [],
        totalHours: 0,
      });
    }

    setTimesheet(days);
    // Reset selected day when week changes
    setSelectedDayIndex(0);
  }, [weekStart]);

  const resolvedLocation = session?.staffProfile?.Location?.trim() || DEFAULT_HOLIDAY_LOCATION;

  // Load yearly holidays once per location/year and filter locally
  useEffect(() => {
    const location = resolvedLocation;
    if (!location) {
      setHolidays([]);
      return;
    }

    const monday = startOfWeek(weekStart, { weekStartsOn: 1 });
    const sunday = addDays(monday, 6);
    const yearSet = new Set<number>([monday.getFullYear(), sunday.getFullYear()]);

    const fetchHolidays = async () => {
      const missingYears = Array.from(yearSet).filter((year) => {
        const cacheKey = `${location}:${year}`;
        return !holidayCacheRef.current[cacheKey];
      });

      if (missingYears.length > 0) {
        try {
          const responses = await Promise.all(
            missingYears.map(async (year) => {
              const response = await fetch(`/api/timesheet/holidays?year=${year}`);

              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || `Failed to load holidays for ${year}`);
              }

              const payload = await response.json();
              if (!payload.success) {
                throw new Error(payload.error || `Failed to load holidays for ${year}`);
              }

              holidayCacheRef.current[`${location}:${year}`] = payload.data || [];
              return payload.data || [];
            })
          );

          if (!responses.length) {
            return;
          }
        } catch (error) {
          console.error('Error loading holidays:', error);
        }
      }

      const combined = Array.from(yearSet)
        .map((year) => holidayCacheRef.current[`${location}:${year}`] || [])
        .flat();
      setHolidays(combined);
    };

    fetchHolidays();
  }, [weekStart, resolvedLocation]);

  // Load existing entries from Google Sheets
  useEffect(() => {
    async function loadExistingEntries() {
      if (!session?.staffProfile || loading) {
        // console.log(`[WeeklyTimesheet] Skipping load - session: ${!!session?.staffProfile}, loading: ${loading}`);
        return;
      }

      const monday = startOfWeek(weekStart, { weekStartsOn: 1 });
      const weekStartStr = format(monday, 'yyyy-MM-dd');
      
      // Prevent loading the same week multiple times
      if (loadedWeekRef.current === weekStartStr) {
        // console.log(`[WeeklyTimesheet] Already loaded week: ${weekStartStr}`);
        return;
      }

      // Wait for timesheet structure to be initialized
      // Use a small delay to ensure timesheet structure is ready
      if (timesheet.length === 0) {
        // Use setTimeout to wait for timesheet structure to be initialized
        setTimeout(() => loadExistingEntries(), 100);
        return;
      }

      try {
        // console.log(`[WeeklyTimesheet] Loading entries for week: ${weekStartStr}`);
        loadedWeekRef.current = weekStartStr;
        const response = await fetch(`/api/timesheet/get?weekStart=${weekStartStr}`);
        
        if (response.ok) {
          const result = await response.json();
          // console.log(`[WeeklyTimesheet] API response:`, result);
          if (result.success && result.data) {
            const entriesByDate = result.data as Record<string, TimeEntry[]>;
            // console.log(`[WeeklyTimesheet] Loaded ${Object.keys(entriesByDate).length} days with entries`);
            // console.log(`[WeeklyTimesheet] Entries by date:`, entriesByDate);
            
            // Update timesheet with existing entries
            setTimesheet((prevTimesheet) => {
              // Only update if timesheet structure matches
              if (prevTimesheet.length === 0) {
                // console.warn(`[WeeklyTimesheet] Timesheet structure not ready`);
                return prevTimesheet;
              }
              
              return prevTimesheet.map((day) => {
                const existingEntries = entriesByDate[day.date] || [];
                const totalHours = existingEntries.reduce((sum, entry) => sum + (entry.hours || 0), 0);
                
                // console.log(`[WeeklyTimesheet] Day ${day.date}: ${existingEntries.length} entries, ${totalHours} hours`);
                
                return {
                  ...day,
                  entries: existingEntries,
                  totalHours,
                };
              });
            });
          } else {
            // console.log(`[WeeklyTimesheet] No entries found for week: ${weekStartStr}`, result);
          }
        } else {
          const errorText = await response.text();
          console.error('Failed to load existing entries:', errorText);
          loadedWeekRef.current = null; // Reset on error to allow retry
        }
      } catch (error) {
        console.error('Error loading existing entries:', error);
        loadedWeekRef.current = null; // Reset on error to allow retry
      }
    }

    loadExistingEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, session?.staffProfile?.EmployeeID, loading]);

  // Load leave data from API (API uses Redis cache)
  // Focus on months that contain the displayed week
  useEffect(() => {
    const employeeId = session?.staffProfile?.EmployeeID;
    if (!employeeId) {
      return;
    }

    const monday = startOfWeek(weekStart, { weekStartsOn: 1 });
    const sunday = addDays(monday, 6);
    
    // Get months that contain this week (Monday and Sunday might be in different months)
    const mondayMonth = monday.getMonth() + 1; // 1-12
    const sundayMonth = sunday.getMonth() + 1; // 1-12
    const mondayYear = monday.getFullYear();
    const sundayYear = sunday.getFullYear();

    const monthsToLoad: Array<{ year: number; month: number }> = [
      { year: mondayYear, month: mondayMonth },
    ];

    // Add Sunday's month if different
    if (mondayYear !== sundayYear || mondayMonth !== sundayMonth) {
      monthsToLoad.push({ year: sundayYear, month: sundayMonth });
    }

    // Check in-memory cache first
    const cacheKeys = monthsToLoad.map(({ year, month }) => `${year}-${month}`);
    const cachedData: LeaveDayEntry[] = [];
    const missingMonths: Array<{ year: number; month: number }> = [];

    monthsToLoad.forEach(({ year, month }) => {
      const key = `${year}-${month}`;
      const cached = leaveDataCacheRef.current.get(key);
      if (cached) {
        cachedData.push(...cached);
      } else {
        missingMonths.push({ year, month });
      }
    });

    // If all data is cached, use it
    if (missingMonths.length === 0) {
      setLeaveData(cachedData);
      return;
    }

    // Load missing months from API (API will use Redis cache)
    const loadMissingMonths = async () => {
      try {
        const responses = await Promise.all(
          missingMonths.map(async ({ year, month }) => {
            const response = await fetch(`/api/staff/leave/monthly?year=${year}&month=${month}`);
            if (!response.ok) {
              throw new Error(`Failed to load monthly leave data for ${year}-${month}`);
            }
            const payload = await response.json();
            if (!payload.success) {
              throw new Error(payload.error || `Failed to load monthly leave data for ${year}-${month}`);
            }
            return { year, month, data: payload.data || [] };
          })
        );

        // Update in-memory cache
        responses.forEach(({ year, month, data }) => {
          const key = `${year}-${month}`;
          leaveDataCacheRef.current.set(key, data);
        });

        // Combine all data (cached + newly loaded)
        const allData = [...cachedData];
        responses.forEach(({ data }) => {
          allData.push(...data);
        });

        setLeaveData(allData);
      } catch (error) {
        console.error('[WeeklyTimesheet] Error loading monthly leave data:', error);
        // Still set cached data if available
        if (cachedData.length > 0) {
          setLeaveData(cachedData);
        }
      }
    };

    loadMissingMonths();
  }, [weekStart, session?.staffProfile?.EmployeeID]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load master data (projects and tasks)
  useEffect(() => {
    async function loadMasterData() {
      try {
        const [projectsRes, tasksRes] = await Promise.all([
          fetch('/api/master/projects'),
          fetch('/api/master/tasks'),
        ]);

        if (projectsRes.ok) {
          const projectsData = await projectsRes.json();
          if (projectsData.data) {
            // Handle both old format (array) and new format (object with projects and clients)
            if (Array.isArray(projectsData.data)) {
              setProjects(projectsData.data);
              // Extract unique clients from projects
              const uniqueClients = Array.from(
                new Set(projectsData.data.map((p: Project) => p.ProjectClient).filter((client: string) => client))
              ).sort() as string[];
              setClients(uniqueClients);
            } else {
              setProjects(projectsData.data.projects || []);
              setClients((projectsData.data.clients || []) as string[]);
            }
          }
        }

        if (tasksRes.ok) {
          const tasksData = await tasksRes.json();
          setTasks(tasksData.data || []);
        }
      } catch (error) {
        console.error('Error loading master data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadMasterData();
  }, []);

  const handleAddEntry = (dayIndex: number) => {
    const newEntry: TimeEntry = {
      id: Date.now().toString(),
      projectId: '',
      taskId: '',
      hours: 0,
    };

    const updatedTimesheet = [...timesheet];
    updatedTimesheet[dayIndex].entries.push(newEntry);
    setTimesheet(updatedTimesheet);
  };

  const handleUpdateEntry = (
    dayIndex: number,
    entryIndex: number,
    updates: Partial<TimeEntry>
  ) => {
    const updatedTimesheet = [...timesheet];
    updatedTimesheet[dayIndex].entries[entryIndex] = {
      ...updatedTimesheet[dayIndex].entries[entryIndex],
      ...updates,
    };

    // Recalculate total hours for the day
    updatedTimesheet[dayIndex].totalHours = updatedTimesheet[
      dayIndex
    ].entries.reduce((sum, entry) => sum + (entry.hours || 0), 0);

    setTimesheet(updatedTimesheet);
  };

  const handleDeleteEntry = (dayIndex: number, entryIndex: number) => {
    const updatedTimesheet = [...timesheet];
    updatedTimesheet[dayIndex].entries.splice(entryIndex, 1);

    // Recalculate total hours
    updatedTimesheet[dayIndex].totalHours = updatedTimesheet[
      dayIndex
    ].entries.reduce((sum, entry) => sum + (entry.hours || 0), 0);

    setTimesheet(updatedTimesheet);
  };

  const handleCopyYesterday = (dayIndex: number) => {
    if (dayIndex === 0) return; // Can't copy from before Monday

    const yesterday = timesheet[dayIndex - 1];
    const copiedEntries: TimeEntry[] = yesterday.entries.map((entry) => ({
      ...entry,
      id: Date.now().toString() + Math.random(),
    }));

    const updatedTimesheet = [...timesheet];
    updatedTimesheet[dayIndex].entries = [
      ...updatedTimesheet[dayIndex].entries,
      ...copiedEntries,
    ];
    updatedTimesheet[dayIndex].totalHours = updatedTimesheet[
      dayIndex
    ].entries.reduce((sum, entry) => sum + (entry.hours || 0), 0);

    setTimesheet(updatedTimesheet);
  };

  const handleSubmitWeek = async () => {
    // Check if there are any entries in the week
    const hasEntries = timesheet.some((day) => day.entries.length > 0);
    if (!hasEntries) {
      alert('Please add at least one entry before submitting.');
      return;
    }

    // Validate all entries across all days
    const invalidDays: string[] = [];
    timesheet.forEach((day, index) => {
      const invalidEntries = day.entries.filter((entry) => {
        // Check if entry has all required fields
        // Note: We can't check client here as it's not stored in entry
        // Client validation is handled in TimeEntryForm component
        // projectId can be either a valid project ID or a custom project name (text from textbox)
        return !entry.projectId || entry.projectId.trim() === '' || !entry.taskId || entry.hours <= 0;
      });
      if (invalidEntries.length > 0) {
        const dayName = format(parseISO(day.date), 'EEEE');
        invalidDays.push(dayName);
      }
    });

    if (invalidDays.length > 0) {
      alert(
        `Please complete all required fields (Client, Project, Task, and Hours) for: ${invalidDays.join(', ')}`
      );
      return;
    }

    setSubmitting(true);

    try {
      const results = await submitWeekDaysSequentially(
        timesheet.map((day) => ({
          date: day.date,
          entries: day.entries.map((entry) => ({
            projectId: entry.projectId,
            taskId: entry.taskId,
            hours: entry.hours,
          })),
          // No automatic acknowledgments — server returns policyCode; we confirm explicitly.
        })),
        async (day) => {
          const response = await fetch('/api/timesheet/submit', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              date: day.date,
              entries: day.entries,
              leaveOverride: day.leaveOverride,
              holidayAcknowledged: day.holidayAcknowledged,
              futureAcknowledged: day.futureAcknowledged,
              over24Acknowledged: day.over24Acknowledged,
            }),
          });

          const result = await response.json();
          return {
            success: result.success,
            error: result.error,
            policyCode: result.policyCode,
          };
        },
        async (date, policyCode, message) => {
          const label =
            policyCode === 'LEAVE_OVERRIDE_REQUIRED'
              ? 'full-day leave'
              : policyCode === 'HOLIDAY_ACK_REQUIRED'
                ? 'holiday'
                : policyCode === 'FUTURE_ACK_REQUIRED'
                  ? 'future date'
                  : policyCode === 'OVER_24_ACK_REQUIRED'
                    ? 'more than 24 hours'
                    : policyCode;
          return window.confirm(
            `${message}\n\nDate: ${date}\nCondition: ${label}\n\nClick OK to acknowledge and retry this day, or Cancel to skip.`
          );
        }
      );
      const failedDays = results.filter((r) => !r.success);

      if (failedDays.length === 0) {
        alert('Weekly timesheet submitted successfully!');
        
        // Reset loaded week ref to force reload from Google Sheets
        const monday = startOfWeek(weekStart, { weekStartsOn: 1 });
        const weekStartStr = format(monday, 'yyyy-MM-dd');
        loadedWeekRef.current = null;
        
        // Reload entries from Google Sheets
        try {
          // console.log(`[WeeklyTimesheet] Reloading entries after submit for week: ${weekStartStr}`);
          const response = await fetch(`/api/timesheet/get?weekStart=${weekStartStr}`);
          if (response.ok) {
            const result = await response.json();
            // console.log(`[WeeklyTimesheet] Reload response:`, result);
            if (result.success && result.data) {
              const entriesByDate = result.data as Record<string, TimeEntry[]>;
              // console.log(`[WeeklyTimesheet] Reloaded entries:`, entriesByDate);
              
              // Update timesheet with entries from Google Sheets
              setTimesheet((prevTimesheet) => {
                return prevTimesheet.map((day) => {
                  const existingEntries = entriesByDate[day.date] || [];
                  const totalHours = existingEntries.reduce((sum, entry) => sum + (entry.hours || 0), 0);
                  
                  // console.log(`[WeeklyTimesheet] Day ${day.date}: ${existingEntries.length} entries, ${totalHours} hours`);
                  
                  return {
                    ...day,
                    entries: existingEntries,
                    totalHours,
                  };
                });
              });
              
              // Mark as loaded
              loadedWeekRef.current = weekStartStr;
            } else {
              console.warn(`[WeeklyTimesheet] Reload failed:`, result.error);
            }
          } else {
            const errorText = await response.text();
            console.error(`[WeeklyTimesheet] Reload error:`, errorText);
          }
        } catch (error) {
          console.error('Error reloading entries after submit:', error);
        }
      } else {
        const failedDates = failedDays.map((r) => format(parseISO(r.date), 'MMM d')).join(', ');
        alert(
          `Some days failed to submit: ${failedDates}\nErrors: ${failedDays.map((r) => r.error).join(', ')}`
        );
      }
    } catch (error) {
      console.error('Error submitting weekly timesheet:', error);
      alert('Failed to submit timesheet. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const weekTotalHours = timesheet.reduce(
    (sum, day) => sum + day.totalHours,
    0
  );

  const activeMonthKeys = useMemo(() => {
    const keys = new Set<string>();
    timesheet.forEach((day) => {
      const date = parseISO(day.date);
      if (!isNaN(date.getTime())) {
        keys.add(`${date.getFullYear()}-${date.getMonth()}`);
      }
    });
    return keys;
  }, [timesheet]);

  const visibleHolidays = useMemo(() => {
    if (holidays.length === 0 || activeMonthKeys.size === 0) {
      return [];
    }

    return holidays.filter((holiday) => {
      const date = parseISO(holiday.date);
      if (isNaN(date.getTime())) {
        return false;
      }
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      return activeMonthKeys.has(key);
    });
  }, [holidays, activeMonthKeys]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-lg text-gray-900 dark:text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-4 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Weekly Timesheet
        </h1>
        {session?.staffProfile && (
          <div className="text-gray-600 dark:text-gray-400 text-sm sm:text-base">
            <p>
              {session.staffProfile.FirstName} {session.staffProfile.LastName} (
              {session.staffProfile.Position})
            </p>
            {timesheet[0] && (
              <p className="text-xs sm:text-sm mt-1">
                Week of {format(parseISO(timesheet[0].date), 'MMM d, yyyy')}
              </p>
            )}
          </div>
        )}
        <div className="mt-4 text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
          Week Total: {weekTotalHours.toFixed(2)} hours
        </div>
        
        {/* Submit Week Button and Controls */}
        <div className="mt-4 sm:mt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center flex-wrap">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center flex-wrap flex-1">
              <button
                onClick={handleSubmitWeek}
                disabled={submitting || weekTotalHours === 0}
                className="w-full sm:w-auto px-6 py-3 bg-green-600 dark:bg-green-700 text-white font-semibold rounded-lg hover:bg-green-700 dark:hover:bg-green-800 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed shadow-md transition-colors text-sm sm:text-base"
              >
                {submitting ? 'Submitting...' : 'Submit Week'}
              </button>
              {weekTotalHours === 0 && (
                <p className="mt-2 sm:mt-0 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                  Add entries to enable submission
                </p>
              )}
              
              {/* Tab View: Day Selection Buttons */}
              {viewMode === 'tab' && (
                <div className="flex items-center gap-2 flex-wrap">
                  {timesheet.map((day, dayIndex) => {
                    const dayName = format(parseISO(day.date), 'EEE');
                    const dayDate = format(parseISO(day.date), 'MMM d');
                    const isSelected = selectedDayIndex === dayIndex;
                    
                    // Check holiday and leave status
                    const holidayEntry = visibleHolidays.find((holiday) => holiday.date === day.date);
                    const isHoliday = Boolean(holidayEntry?.is_holiday ?? holidayEntry);
                    const leaveEntry = getLeaveEntry(day.date, leaveData);
                    const isFull = isFullLeave(day.date, leaveData);
                    const isHalf = isHalfLeave(day.date, leaveData);
                    
                    // Build tooltip text
                    let tooltipText = `${dayName} ${dayDate}`;
                    if (isHoliday && holidayEntry) {
                      tooltipText += `\n🎉 Holiday: ${holidayEntry.name}`;
                      if (holidayEntry.remarks) {
                        tooltipText += `\n${holidayEntry.remarks}`;
                      }
                    }
                    if (leaveEntry) {
                      if (isFull) {
                        tooltipText += `\n🚫 On leave (Full Day): ${leaveEntry.leaveType}`;
                        if (leaveEntry.reason) {
                          tooltipText += `\nReason: ${leaveEntry.reason}`;
                        }
                      } else if (isHalf) {
                        tooltipText += `\n⚠️ On leave (Half Day - ${leaveEntry.dayType}): ${leaveEntry.leaveType}`;
                        if (leaveEntry.reason) {
                          tooltipText += `\nReason: ${leaveEntry.reason}`;
                        }
                      }
                    }
                    
                    // Determine button style based on status
                    let buttonClasses = 'px-4 py-2 border rounded-lg font-medium text-sm transition-colors';
                    
                    if (isSelected) {
                      if (isHoliday) {
                        buttonClasses += ' bg-red-600 text-white border-red-600 shadow-md';
                      } else if (isFull) {
                        buttonClasses += ' bg-orange-600 text-white border-orange-600 shadow-md';
                      } else if (isHalf) {
                        buttonClasses += ' bg-yellow-600 text-white border-yellow-600 shadow-md';
                      } else {
                        buttonClasses += ' bg-blue-600 text-white border-blue-600 shadow-md';
                      }
                    } else {
                      if (isHoliday) {
                        buttonClasses += ' bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/50';
                      } else if (isFull) {
                        buttonClasses += ' bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700 hover:bg-orange-100 dark:hover:bg-orange-900/50';
                      } else if (isHalf) {
                        buttonClasses += ' bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700 hover:bg-yellow-100 dark:hover:bg-yellow-900/50';
                      } else {
                        buttonClasses += ' bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700';
                      }
                    }
                    
                    return (
                      <button
                        key={day.date}
                        onClick={() => setSelectedDayIndex(dayIndex)}
                        className={buttonClasses}
                        title={tooltipText}
                      >
                        {dayName} {dayDate}
                        {isHoliday && <span className="ml-1">🎉</span>}
                        {isFull && <span className="ml-1">🚫</span>}
                        {isHalf && <span className="ml-1">⚠️</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            
            {/* View Mode Selection - Icon Buttons (Always on the right) */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => onViewModeChange('column')}
                title="Weekly View"
                className={`p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                  viewMode === 'column'
                    ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                }`}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
                  />
                </svg>
              </button>
              <button
                onClick={() => onViewModeChange('tab')}
                title="Daily View"
                className={`p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                  viewMode === 'tab'
                    ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                }`}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Column View: Show all days */}
      {viewMode === 'column' && (
        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-7">
          {timesheet.map((day, dayIndex) => (
            <DailyCard
              key={day.date}
              day={day}
              dayIndex={dayIndex}
              projects={projects}
              clients={clients}
              tasks={tasks}
              leaveData={leaveData}
              holidays={visibleHolidays}
              onAddEntry={() => handleAddEntry(dayIndex)}
              onUpdateEntry={(entryIndex, updates) =>
                handleUpdateEntry(dayIndex, entryIndex, updates)
              }
              onDeleteEntry={(entryIndex) =>
                handleDeleteEntry(dayIndex, entryIndex)
              }
              onCopyYesterday={() => handleCopyYesterday(dayIndex)}
              submitting={submitting}
            />
          ))}
        </div>
      )}

      {/* Tab View: Show only selected day */}
      {viewMode === 'tab' && timesheet[selectedDayIndex] && (
        <div className="w-full">
          <DailyCard
            key={timesheet[selectedDayIndex].date}
            day={timesheet[selectedDayIndex]}
            dayIndex={selectedDayIndex}
            projects={projects}
            clients={clients}
            tasks={tasks}
            leaveData={leaveData}
            holidays={visibleHolidays}
            showLabels={true}
            onAddEntry={() => handleAddEntry(selectedDayIndex)}
            onUpdateEntry={(entryIndex, updates) =>
              handleUpdateEntry(selectedDayIndex, entryIndex, updates)
            }
            onDeleteEntry={(entryIndex) =>
              handleDeleteEntry(selectedDayIndex, entryIndex)
            }
            onCopyYesterday={() => handleCopyYesterday(selectedDayIndex)}
            submitting={submitting}
          />
        </div>
      )}
    </div>
  );
}


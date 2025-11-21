'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { format, startOfWeek, addDays, parseISO } from 'date-fns';
import DailyCard from './DailyCard';
import { Project, Task, TimeEntry, DailyTimesheet } from '@/types';

interface WeeklyTimesheetProps {
  weekStart: Date;
}

export default function WeeklyTimesheet({ weekStart }: WeeklyTimesheetProps) {
  const { data: session } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<string[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timesheet, setTimesheet] = useState<DailyTimesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const loadedWeekRef = useRef<string | null>(null);
  const timesheetInitializedRef = useRef<boolean>(false);

  // Initialize days of the week (Monday-Friday)
  useEffect(() => {
    const monday = startOfWeek(weekStart, { weekStartsOn: 1 });
    const weekStartStr = format(monday, 'yyyy-MM-dd');
    
    // Reset loaded week ref when week changes to force reload
    loadedWeekRef.current = null;
    
    const days: DailyTimesheet[] = [];

    for (let i = 0; i < 5; i++) {
      const date = addDays(monday, i);
      days.push({
        date: format(date, 'yyyy-MM-dd'),
        entries: [],
        totalHours: 0,
      });
    }

    setTimesheet(days);
  }, [weekStart]);

  // Load existing entries from Google Sheets
  useEffect(() => {
    async function loadExistingEntries() {
      if (!session?.staffProfile || loading) {
        console.log(`[WeeklyTimesheet] Skipping load - session: ${!!session?.staffProfile}, loading: ${loading}`);
        return;
      }

      const monday = startOfWeek(weekStart, { weekStartsOn: 1 });
      const weekStartStr = format(monday, 'yyyy-MM-dd');
      
      // Prevent loading the same week multiple times
      if (loadedWeekRef.current === weekStartStr) {
        console.log(`[WeeklyTimesheet] Already loaded week: ${weekStartStr}`);
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
        console.log(`[WeeklyTimesheet] Loading entries for week: ${weekStartStr}`);
        loadedWeekRef.current = weekStartStr;
        const response = await fetch(`/api/timesheet/get?weekStart=${weekStartStr}`);
        
        if (response.ok) {
          const result = await response.json();
          console.log(`[WeeklyTimesheet] API response:`, result);
          if (result.success && result.data) {
            const entriesByDate = result.data as Record<string, TimeEntry[]>;
            console.log(`[WeeklyTimesheet] Loaded ${Object.keys(entriesByDate).length} days with entries`);
            console.log(`[WeeklyTimesheet] Entries by date:`, entriesByDate);
            
            // Update timesheet with existing entries
            setTimesheet((prevTimesheet) => {
              // Only update if timesheet structure matches
              if (prevTimesheet.length === 0) {
                console.warn(`[WeeklyTimesheet] Timesheet structure not ready`);
                return prevTimesheet;
              }
              
              return prevTimesheet.map((day) => {
                const existingEntries = entriesByDate[day.date] || [];
                const totalHours = existingEntries.reduce((sum, entry) => sum + (entry.hours || 0), 0);
                
                console.log(`[WeeklyTimesheet] Day ${day.date}: ${existingEntries.length} entries, ${totalHours} hours`);
                
                return {
                  ...day,
                  entries: existingEntries,
                  totalHours,
                };
              });
            });
          } else {
            console.log(`[WeeklyTimesheet] No entries found for week: ${weekStartStr}`, result);
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

  // Load master data
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
        return !entry.projectId || !entry.taskId || entry.hours <= 0;
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
      // Submit all days that have entries
      const submitPromises = timesheet
        .filter((day) => day.entries.length > 0)
        .map(async (day) => {
          const response = await fetch('/api/timesheet/submit', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              date: day.date,
              entries: day.entries.map((entry) => ({
                projectId: entry.projectId,
                taskId: entry.taskId,
                hours: entry.hours,
              })),
            }),
          });

          const result = await response.json();
          return { date: day.date, success: result.success, error: result.error };
        });

      const results = await Promise.all(submitPromises);
      const failedDays = results.filter((r) => !r.success);

      if (failedDays.length === 0) {
        alert('Weekly timesheet submitted successfully!');
        
        // Reset loaded week ref to force reload from Google Sheets
        const monday = startOfWeek(weekStart, { weekStartsOn: 1 });
        const weekStartStr = format(monday, 'yyyy-MM-dd');
        loadedWeekRef.current = null;
        
        // Reload entries from Google Sheets
        try {
          console.log(`[WeeklyTimesheet] Reloading entries after submit for week: ${weekStartStr}`);
          const response = await fetch(`/api/timesheet/get?weekStart=${weekStartStr}`);
          if (response.ok) {
            const result = await response.json();
            console.log(`[WeeklyTimesheet] Reload response:`, result);
            if (result.success && result.data) {
              const entriesByDate = result.data as Record<string, TimeEntry[]>;
              console.log(`[WeeklyTimesheet] Reloaded entries:`, entriesByDate);
              
              // Update timesheet with entries from Google Sheets
              setTimesheet((prevTimesheet) => {
                return prevTimesheet.map((day) => {
                  const existingEntries = entriesByDate[day.date] || [];
                  const totalHours = existingEntries.reduce((sum, entry) => sum + (entry.hours || 0), 0);
                  
                  console.log(`[WeeklyTimesheet] Day ${day.date}: ${existingEntries.length} entries, ${totalHours} hours`);
                  
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Weekly Timesheet
        </h1>
        {session?.staffProfile && (
          <div className="text-gray-600">
            <p>
              {session.staffProfile.FirstName} {session.staffProfile.LastName} (
              {session.staffProfile.Position})
            </p>
            {timesheet[0] && (
              <p className="text-sm">
                Week of {format(parseISO(timesheet[0].date), 'MMM d, yyyy')}
              </p>
            )}
          </div>
        )}
        <div className="mt-4 text-lg font-semibold">
          Week Total: {weekTotalHours.toFixed(2)} hours
        </div>
        
        {/* Submit Week Button */}
        <div className="mt-6">
          <button
            onClick={handleSubmitWeek}
            disabled={submitting || weekTotalHours === 0}
            className="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed shadow-md transition-colors"
          >
            {submitting ? 'Submitting...' : 'Submit Week'}
          </button>
          {weekTotalHours === 0 && (
            <p className="mt-2 text-sm text-gray-500">
              Add entries to enable submission
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-5">
        {timesheet.map((day, dayIndex) => (
          <DailyCard
            key={day.date}
            day={day}
            dayIndex={dayIndex}
            projects={projects}
            clients={clients}
            tasks={tasks}
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
    </div>
  );
}


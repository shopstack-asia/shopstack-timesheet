'use client';

import { useState, useEffect } from 'react';
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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timesheet, setTimesheet] = useState<DailyTimesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Initialize days of the week (Monday-Friday)
  useEffect(() => {
    const monday = startOfWeek(weekStart, { weekStartsOn: 1 });
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
          setProjects(projectsData.data || []);
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

    // Prefill from last entry of the day if exists
    const day = timesheet[dayIndex];
    if (day.entries.length > 0) {
      const lastEntry = day.entries[day.entries.length - 1];
      newEntry.projectId = lastEntry.projectId;
      newEntry.taskId = lastEntry.taskId;
    }

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

  const handleSubmitDay = async (dayIndex: number) => {
    const day = timesheet[dayIndex];
    if (day.entries.length === 0) {
      alert('Please add at least one entry before submitting.');
      return;
    }

    // Validate all entries
    const invalidEntries = day.entries.filter(
      (entry) => !entry.projectId || !entry.taskId || entry.hours <= 0
    );

    if (invalidEntries.length > 0) {
      alert('Please complete all entries (Project, Task, and Hours) before submitting.');
      return;
    }

    setSubmitting(true);

    try {
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

      if (result.success) {
        alert('Timesheet submitted successfully!');
        // Clear entries for the submitted day
        const updatedTimesheet = [...timesheet];
        updatedTimesheet[dayIndex].entries = [];
        updatedTimesheet[dayIndex].totalHours = 0;
        setTimesheet(updatedTimesheet);
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error submitting timesheet:', error);
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
      </div>

      <div className="grid gap-6 md:grid-cols-5">
        {timesheet.map((day, dayIndex) => (
          <DailyCard
            key={day.date}
            day={day}
            dayIndex={dayIndex}
            projects={projects}
            tasks={tasks}
            onAddEntry={() => handleAddEntry(dayIndex)}
            onUpdateEntry={(entryIndex, updates) =>
              handleUpdateEntry(dayIndex, entryIndex, updates)
            }
            onDeleteEntry={(entryIndex) =>
              handleDeleteEntry(dayIndex, entryIndex)
            }
            onCopyYesterday={() => handleCopyYesterday(dayIndex)}
            onSubmit={() => handleSubmitDay(dayIndex)}
            submitting={submitting}
          />
        ))}
      </div>
    </div>
  );
}


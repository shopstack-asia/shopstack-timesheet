'use client';

import { format, parseISO } from 'date-fns';
import TimeEntryForm from './TimeEntryForm';
import { DailyTimesheet, Project, Task, TimeEntry } from '@/types';

interface DailyCardProps {
  day: DailyTimesheet;
  dayIndex: number;
  projects: Project[];
  clients: string[];
  tasks: Task[];
  onAddEntry: () => void;
  onUpdateEntry: (entryIndex: number, updates: Partial<TimeEntry>) => void;
  onDeleteEntry: (entryIndex: number) => void;
  onCopyYesterday: () => void;
  submitting: boolean;
}

export default function DailyCard({
  day,
  dayIndex,
  projects,
  clients,
  tasks,
  onAddEntry,
  onUpdateEntry,
  onDeleteEntry,
  onCopyYesterday,
  submitting,
}: DailyCardProps) {
  const dayName = format(parseISO(day.date), 'EEEE');
  const dayDate = format(parseISO(day.date), 'MMM d');

  return (
    <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200">
      <div className="mb-4 pb-2 border-b">
        <h3 className="text-lg font-semibold text-gray-900">{dayName}</h3>
        <p className="text-sm text-gray-600">{dayDate}</p>
        <div className="mt-2 text-sm font-medium text-blue-600">
          Total: {day.totalHours.toFixed(2)} hrs
        </div>
      </div>

      <div className="space-y-3 mb-4">
        {day.entries.map((entry, entryIndex) => (
          <TimeEntryForm
            key={entry.id}
            entry={entry}
            projects={projects}
            clients={clients}
            tasks={tasks}
            onUpdate={(updates) => onUpdateEntry(entryIndex, updates)}
            onDelete={() => onDeleteEntry(entryIndex)}
          />
        ))}
      </div>

      <div className="space-y-2">
        <button
          onClick={onAddEntry}
          className="w-full px-3 py-2 text-sm bg-blue-50 text-blue-700 rounded hover:bg-blue-100 border border-blue-200"
        >
          + Add Entry
        </button>

        {dayIndex > 0 && day.entries.length === 0 && (
          <button
            onClick={onCopyYesterday}
            disabled={submitting}
            className="w-full px-3 py-2 text-sm bg-gray-50 text-gray-700 rounded hover:bg-gray-100 border border-gray-200 disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            Copy Yesterday
          </button>
        )}
      </div>
    </div>
  );
}


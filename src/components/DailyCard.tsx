'use client';

import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import TimeEntryForm from './TimeEntryForm';
import { DailyTimesheet, Project, Task, TimeEntry, LeaveDayEntry, Holiday } from '@/types';
import { getLeaveEntry, isFullLeave, isHalfLeave } from '@/lib/leave-utils';

interface DailyCardProps {
  day: DailyTimesheet;
  dayIndex: number;
  projects: Project[];
  clients: string[];
  tasks: Task[];
  leaveData: LeaveDayEntry[];
  holidays: Holiday[];
  showLabels?: boolean;
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
  leaveData,
  holidays,
  showLabels = false,
  onAddEntry,
  onUpdateEntry,
  onDeleteEntry,
  onCopyYesterday,
  submitting,
}: DailyCardProps) {
  const [showLeaveInfo, setShowLeaveInfo] = useState(false);
  const dayName = format(parseISO(day.date), 'EEEE');
  const dayDate = format(parseISO(day.date), 'MMM d');
  
  const leaveEntry = getLeaveEntry(day.date, leaveData);
  const isFull = isFullLeave(day.date, leaveData);
  const isHalf = isHalfLeave(day.date, leaveData);
  const holidayEntry = holidays.find((holiday) => holiday.date === day.date);
  const isHoliday = Boolean(holidayEntry?.is_holiday ?? holidayEntry);
  const holidayTooltip = holidayEntry
    ? `${holidayEntry.name}${holidayEntry.remarks ? ` — ${holidayEntry.remarks}` : ''}`
    : '';

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 border ${
        isHoliday
          ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30'
          : isFull
          ? 'border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/30'
          : isHalf
          ? 'border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/30'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <div className="mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-start justify-between">
          <div>
            <h3
              className="text-lg font-semibold text-gray-900 dark:text-white"
              title={holidayEntry ? holidayTooltip : undefined}
            >
              {dayName}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">{dayDate}</p>
            <div className="mt-2 text-sm font-medium text-blue-600 dark:text-blue-400">
              Total: {day.totalHours.toFixed(2)} hrs
            </div>
          </div>
          {leaveEntry && (
            <button
              onClick={() => setShowLeaveInfo(!showLeaveInfo)}
              className="ml-2 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="View leave information"
              type="button"
            >
              <svg
                className={`w-5 h-5 ${
                  isFull 
                    ? 'text-orange-600 dark:text-orange-400' 
                    : isHalf 
                    ? 'text-yellow-600 dark:text-yellow-400' 
                    : 'text-gray-600 dark:text-gray-400'
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>
          )}
        </div>
        
        {/* Leave Information Banner */}
        {leaveEntry && (
          <div className={`mt-3 p-2 rounded text-xs ${
            isFull ? 'bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-200' : 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200'
          }`}>
            <div className="font-semibold">
              {isFull 
                ? `🚫 On leave (Full Day): ${leaveEntry.leaveType}${leaveEntry.reason ? ` — ${leaveEntry.reason}` : ''}`
                : `⚠️ On leave (Half Day - ${leaveEntry.dayType}): ${leaveEntry.leaveType}${leaveEntry.reason ? ` — ${leaveEntry.reason}` : ''}`}
            </div>
            {showLeaveInfo && (
              <div className="mt-2 space-y-1">
                {leaveEntry.leaveType && <div><strong>Leave Type:</strong> {leaveEntry.leaveType}</div>}
                {leaveEntry.status && <div><strong>Status:</strong> {leaveEntry.status}</div>}
                {leaveEntry.reason && <div><strong>Reason:</strong> {leaveEntry.reason}</div>}
                {leaveEntry.dayType && <div><strong>Day Type:</strong> {leaveEntry.dayType}</div>}
                {leaveEntry.approvedBy && <div><strong>Approved By:</strong> {leaveEntry.approvedBy}</div>}
              </div>
            )}
          </div>
        )}

        {holidayEntry && (
          <div
            className="mt-3 p-2 rounded text-xs bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200"
            title={holidayTooltip}
          >
            <div className="font-semibold flex items-center gap-1.5">
              <span>{holidayEntry.name}</span>
            </div>
            {holidayEntry.remarks && (
              <div className="mt-1 text-[11px] text-red-700 dark:text-red-300 break-words">
                {holidayEntry.remarks}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 mb-4">
        {day.entries.map((entry, entryIndex) => (
          <TimeEntryForm
            key={entry.id}
            entry={entry}
            projects={projects}
            clients={clients}
            tasks={tasks}
            disabled={submitting}
            showLabels={showLabels}
            onUpdate={(updates) => onUpdateEntry(entryIndex, updates)}
            onDelete={() => onDeleteEntry(entryIndex)}
          />
        ))}
      </div>

      <div className="space-y-2">
        <button
          onClick={onAddEntry}
          disabled={submitting}
          className="w-full px-3 py-2 text-sm rounded border bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 border-blue-200 dark:border-blue-800 disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:text-gray-400 dark:disabled:text-gray-500 disabled:border-gray-200 dark:disabled:border-gray-600 disabled:cursor-not-allowed"
        >
          + Add Entry
        </button>

        {dayIndex > 0 && day.entries.length === 0 && (
          <button
            onClick={onCopyYesterday}
            disabled={submitting}
            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600 disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
          >
            Copy Yesterday
          </button>
        )}
      </div>
    </div>
  );
}


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
      className={`bg-white rounded-lg shadow-md p-4 border ${
        isHoliday
          ? 'border-red-300 bg-red-50'
          : isFull
          ? 'border-orange-300 bg-orange-50'
          : isHalf
          ? 'border-yellow-300 bg-yellow-50'
          : 'border-gray-200'
      }`}
    >
      <div className="mb-4 pb-2 border-b">
        <div className="flex items-start justify-between">
          <div>
            <h3
              className="text-lg font-semibold text-gray-900"
              title={holidayEntry ? holidayTooltip : undefined}
            >
              {dayName}
            </h3>
            <p className="text-sm text-gray-600">{dayDate}</p>
            <div className="mt-2 text-sm font-medium text-blue-600">
              Total: {day.totalHours.toFixed(2)} hrs
            </div>
          </div>
          {leaveEntry && (
            <button
              onClick={() => setShowLeaveInfo(!showLeaveInfo)}
              className="ml-2 p-1.5 rounded-full hover:bg-gray-100 transition-colors"
              title="View leave information"
              type="button"
            >
              <svg
                className={`w-5 h-5 ${
                  isFull 
                    ? 'text-orange-600' 
                    : isHalf 
                    ? 'text-yellow-600' 
                    : 'text-gray-600'
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
            isFull ? 'bg-orange-100 text-orange-800' : 'bg-yellow-100 text-yellow-800'
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
            className="mt-3 p-2 rounded text-xs bg-red-100 text-red-800"
            title={holidayTooltip}
          >
            <div className="font-semibold flex items-center gap-1.5">
              <span>{holidayEntry.name}</span>
            </div>
            {holidayEntry.remarks && (
              <div className="mt-1 text-[11px] text-red-700 break-words">
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
            disabled={isFull || isHoliday}
            onUpdate={(updates) => onUpdateEntry(entryIndex, updates)}
            onDelete={() => onDeleteEntry(entryIndex)}
          />
        ))}
      </div>

      <div className="space-y-2">
        <button
          onClick={onAddEntry}
          disabled={isFull || isHoliday || submitting}
          className={`w-full px-3 py-2 text-sm rounded border ${
            isHoliday
              ? 'bg-red-100 text-red-500 border-red-200 cursor-not-allowed'
              : isFull
              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
              : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200'
          }`}
        >
          {isHoliday ? '🎉 Holiday' : isFull ? '🚫 Leave Day' : '+ Add Entry'}
        </button>

        {dayIndex > 0 && day.entries.length === 0 && !isHoliday && (
          <button
            onClick={onCopyYesterday}
            disabled={submitting || isHoliday}
            className="w-full px-3 py-2 text-sm bg-gray-50 text-gray-700 rounded hover:bg-gray-100 border border-gray-200 disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            Copy Yesterday
          </button>
        )}
      </div>
    </div>
  );
}


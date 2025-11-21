'use client';

import { useState, useEffect } from 'react';
import { TimeEntry, Project, Task } from '@/types';

interface TimeEntryFormProps {
  entry: TimeEntry;
  projects: Project[];
  tasks: Task[];
  onUpdate: (updates: Partial<TimeEntry>) => void;
  onDelete: () => void;
}

export default function TimeEntryForm({
  entry,
  projects,
  tasks,
  onUpdate,
  onDelete,
}: TimeEntryFormProps) {
  const [projectId, setProjectId] = useState(entry.projectId);
  const [taskId, setTaskId] = useState(entry.taskId);
  const [hours, setHours] = useState(entry.hours.toString());

  useEffect(() => {
    onUpdate({
      projectId,
      taskId,
      hours: parseFloat(hours) || 0,
    });
  }, [projectId, taskId, hours, onUpdate]);

  return (
    <div className="p-3 bg-gray-50 rounded border border-gray-200">
      <div className="space-y-2">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select Project</option>
          {projects.map((project) => (
            <option key={project.ProjectID} value={project.ProjectID}>
              {project.ProjectName} ({project.ProjectCode})
            </option>
          ))}
        </select>

        <select
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select Task</option>
          {tasks.map((task) => (
            <option key={task.TaskID} value={task.TaskID}>
              {task.Task}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <input
            type="number"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            min="0"
            max="24"
            step="0.25"
            placeholder="Hours"
            className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={onDelete}
            className="px-2 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
            title="Delete entry"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}


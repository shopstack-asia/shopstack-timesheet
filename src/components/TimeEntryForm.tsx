'use client';

import { useState, useEffect, useMemo } from 'react';
import { TimeEntry, Project, Task } from '@/types';
import SearchableSelect from './SearchableSelect';

interface TimeEntryFormProps {
  entry: TimeEntry;
  projects: Project[];
  tasks: Task[];
  clients: string[];
  onUpdate: (updates: Partial<TimeEntry>) => void;
  onDelete: () => void;
}

export default function TimeEntryForm({
  entry,
  projects,
  tasks,
  clients,
  onUpdate,
  onDelete,
}: TimeEntryFormProps) {
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [projectId, setProjectId] = useState(entry.projectId);
  const [taskId, setTaskId] = useState(entry.taskId);
  const [hours, setHours] = useState(entry.hours.toString());
  
  // Validation states
  const [touched, setTouched] = useState({
    client: false,
    project: false,
    task: false,
    hours: false,
  });
  
  // Check if fields are valid
  const isValid = {
    client: selectedClient !== '',
    project: projectId !== '',
    task: taskId !== '',
    hours: parseFloat(hours) > 0,
  };
  
  // Show errors only if field has been touched
  const showErrors = {
    client: touched.client && !isValid.client,
    project: touched.project && !isValid.project,
    task: touched.task && !isValid.task,
    hours: touched.hours && !isValid.hours,
  };

  // Initialize selectedClient from current project
  useEffect(() => {
    if (projectId && !selectedClient) {
      const currentProject = projects.find((p) => p.ProjectID === projectId);
      if (currentProject) {
        setSelectedClient(currentProject.ProjectClient);
      }
    }
  }, [projectId, projects, selectedClient]);

  // Filter projects by selected client
  const filteredProjects = useMemo(() => {
    if (!selectedClient) {
      return [];
    }
    return projects.filter((project) => project.ProjectClient === selectedClient);
  }, [projects, selectedClient]);

  // Prepare options for SearchableSelect components
  const clientOptions = useMemo(
    () =>
      clients.map((client) => ({
        value: client,
        label: client,
      })),
    [clients]
  );

  const projectOptions = useMemo(
    () =>
      filteredProjects.map((project) => ({
        value: project.ProjectID,
        label: `${project.ProjectName} (${project.ProjectCode})`,
      })),
    [filteredProjects]
  );

  const taskOptions = useMemo(
    () =>
      tasks.map((task) => ({
        value: task.TaskID,
        label: task.Task,
      })),
    [tasks]
  );

  // Reset projectId when client changes
  useEffect(() => {
    if (selectedClient) {
      const currentProject = projects.find((p) => p.ProjectID === projectId);
      if (currentProject && currentProject.ProjectClient !== selectedClient) {
        setProjectId('');
      }
    }
  }, [selectedClient, projectId, projects]);

  useEffect(() => {
    onUpdate({
      projectId,
      taskId,
      hours: parseFloat(hours) || 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId, hours]);
  
  // Mark fields as touched when user interacts
  const handleClientChange = (value: string) => {
    setTouched((prev) => ({ ...prev, client: true }));
    setSelectedClient(value);
    setProjectId(''); // Reset project when client changes
  };
  
  const handleProjectChange = (value: string) => {
    setTouched((prev) => ({ ...prev, project: true }));
    setProjectId(value);
  };
  
  const handleTaskChange = (value: string) => {
    setTouched((prev) => ({ ...prev, task: true }));
    setTaskId(value);
  };
  
  const handleHoursChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTouched((prev) => ({ ...prev, hours: true }));
    setHours(e.target.value);
  };

  return (
    <div className="p-3 bg-gray-50 rounded border border-gray-200 relative group">
      {/* Remove Button */}
      <button
        onClick={onDelete}
        className="absolute top-0 right-0 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors z-10"
        title="Remove entry"
        type="button"
      >
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>

      <div className="space-y-2 mt-3">
        <div>
          <SearchableSelect
            options={clientOptions}
            value={selectedClient}
            onChange={handleClientChange}
            placeholder="Select Client *"
            required
            error={showErrors.client}
          />
          {showErrors.client && (
            <p className="mt-1 text-xs text-red-600">Client is required</p>
          )}
        </div>

        <div>
          <SearchableSelect
            options={projectOptions}
            value={projectId}
            onChange={handleProjectChange}
            placeholder="Select Project *"
            disabled={!selectedClient}
            required
            error={showErrors.project}
          />
          {showErrors.project && (
            <p className="mt-1 text-xs text-red-600">Project is required</p>
          )}
        </div>

        <div>
          <SearchableSelect
            options={taskOptions}
            value={taskId}
            onChange={handleTaskChange}
            placeholder="Select Task *"
            required
            error={showErrors.task}
          />
          {showErrors.task && (
            <p className="mt-1 text-xs text-red-600">Task is required</p>
          )}
        </div>

        <div>
          <div className="relative">
            <input
              type="number"
              value={hours}
              onChange={handleHoursChange}
              onBlur={() => setTouched((prev) => ({ ...prev, hours: true }))}
              min="0"
              max="24"
              step="0.25"
              placeholder="Hours"
              className={`w-full px-2 py-1 pr-10 text-sm border rounded focus:outline-none focus:ring-2 ${
                showErrors.hours
                  ? 'border-red-500 focus:ring-red-500'
                  : 'border-gray-300 focus:ring-blue-500'
              }`}
            />
            <span className="absolute right-2 top-1/2 transform -translate-y-1/2 text-sm text-gray-500 pointer-events-none">
              hr
            </span>
          </div>
          {showErrors.hours && (
            <p className="mt-1 text-xs text-red-600">Hours must be greater than 0</p>
          )}
        </div>
      </div>
    </div>
  );
}


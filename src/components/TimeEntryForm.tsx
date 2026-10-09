'use client';

import { useState, useEffect, useMemo } from 'react';
import { SalesProject, TimeEntry, Project, Task, TimesheetTaskType } from '@/types';
import SearchableSelect from './SearchableSelect';
import {
  INTERNAL_OPERATIONS_PROJECT_CODE,
  INTERNAL_OPERATIONS_PROJECT_NAME,
  isProjectDeliveryClient,
  isShopstackClient,
  salesProjectCodeTaken,
  sameLabel,
  SHOPSTACK_CLIENT,
  SALES_TASK_NAME,
  TASK_TYPE_OPTIONS,
  uniqueSortedClients,
} from '@/lib/timesheet/task-type';

interface TimeEntryFormProps {
  entry: TimeEntry;
  projects: Project[];
  tasks: Task[];
  clients: string[];
  salesProjects: SalesProject[];
  operationTasks: string[];
  onCreateSalesProject: (input: {
    projectClient: string;
    projectName: string;
    projectCode: string;
  }) => Promise<{ ok: true; project: SalesProject } | { ok: false; error: string }>;
  disabled?: boolean;
  showLabels?: boolean;
  onUpdate: (updates: Partial<TimeEntry>) => void;
  onDelete: () => void;
}

function fieldInputClass(disabled: boolean, invalid: boolean): string {
  return `w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 ${
    disabled
      ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed border-gray-300 dark:border-gray-700'
      : invalid
        ? 'border-red-500 dark:border-red-600 focus:ring-red-500 dark:focus:ring-red-600'
        : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 dark:focus:ring-blue-600'
  }`;
}

export default function TimeEntryForm({
  entry,
  projects,
  tasks,
  clients,
  salesProjects,
  operationTasks,
  onCreateSalesProject,
  disabled = false,
  showLabels = false,
  onUpdate,
  onDelete,
}: TimeEntryFormProps) {
  const [taskType, setTaskType] = useState<TimesheetTaskType>(
    entry.taskType ?? 'project_delivery'
  );
  const [selectedClient, setSelectedClient] = useState(entry.projectClient || '');
  const [projectId, setProjectId] = useState(entry.projectId);
  const [taskId, setTaskId] = useState(entry.taskId);
  const [projectCode, setProjectCode] = useState(entry.projectCode || '');
  const [taskName, setTaskName] = useState(entry.taskName || '');
  const [hours, setHours] = useState(entry.hours.toString());
  const [isCustomProject, setIsCustomProject] = useState(false);
  const [extraClients, setExtraClients] = useState<string[]>([]);
  const [addingClient, setAddingClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectCode, setNewProjectCode] = useState('');
  const [addProjectError, setAddProjectError] = useState('');
  const [savingProject, setSavingProject] = useState(false);

  const [touched, setTouched] = useState({
    client: false,
    project: false,
    task: false,
    hours: false,
  });

  const isSales = taskType === 'sales_presales';
  const isInternalDev = taskType === 'internal_development';
  const isOperations = taskType === 'internal_operations';
  const isDelivery = taskType === 'project_delivery';

  const isValid = {
    client: !isDelivery && !isSales ? true : selectedClient !== '',
    project: isOperations
      ? true
      : isSales
        ? projectCode !== ''
        : projectId.trim() !== '',
    task: isSales ? true : isOperations ? taskName !== '' : taskId !== '',
    hours: parseFloat(hours) > 0,
  };

  const showErrors = {
    client: touched.client && !isValid.client,
    project: touched.project && !isValid.project,
    task: touched.task && !isValid.task,
    hours: touched.hours && !isValid.hours,
  };

  const labelClass =
    'text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap min-w-[110px]';
  const errorClass = `mt-1 text-xs text-red-600 dark:text-red-400 ${
    showLabels ? 'ml-[calc(110px+0.75rem)]' : ''
  }`;

  useEffect(() => {
    if (!isDelivery) return;
    if (projectId && !selectedClient) {
      const currentProject = projects.find((p) => p.ProjectID === projectId);
      if (currentProject) {
        setSelectedClient(currentProject.ProjectClient);
      }
    }
  }, [isDelivery, projectId, projects, selectedClient]);

  const deliveryProjects = useMemo(() => {
    if (!selectedClient) return [];
    return projects.filter((project) => project.ProjectClient === selectedClient);
  }, [projects, selectedClient]);

  const shopstackProjects = useMemo(
    () => projects.filter((project) => isShopstackClient(project.ProjectClient)),
    [projects]
  );

  const deliveryClientOptions = useMemo(
    () =>
      clients
        .filter((client) => isProjectDeliveryClient(client))
        .map((client) => ({ value: client, label: client })),
    [clients]
  );

  const deliveryProjectOptions = useMemo(
    () =>
      deliveryProjects.map((project) => ({
        value: project.ProjectID,
        label: `${project.ProjectName} (${project.ProjectCode})`,
      })),
    [deliveryProjects]
  );

  const shopstackProjectOptions = useMemo(
    () =>
      shopstackProjects.map((project) => ({
        value: project.ProjectID,
        label: `${project.ProjectName} (${project.ProjectCode})`,
      })),
    [shopstackProjects]
  );

  const taskOptions = useMemo(
    () =>
      tasks.map((task) => ({
        value: task.TaskID,
        label: task.Task,
      })),
    [tasks]
  );

  const salesClientOptions = useMemo(
    () =>
      uniqueSortedClients([
        ...salesProjects.map((project) => project.ProjectClient),
        ...extraClients,
      ]).map((client) => ({ value: client, label: client })),
    [salesProjects, extraClients]
  );

  const salesProjectOptions = useMemo(
    () =>
      salesProjects
        .filter((project) => sameLabel(project.ProjectClient, selectedClient))
        .map((project) => ({
          value: project.ProjectCode,
          label: `${project.ProjectName} (${project.ProjectCode})`,
        })),
    [salesProjects, selectedClient]
  );

  const operationTaskOptions = useMemo(
    () => operationTasks.map((task) => ({ value: task, label: task })),
    [operationTasks]
  );

  useEffect(() => {
    if (!isDelivery || !selectedClient) return;
    const currentProject = projects.find((p) => p.ProjectID === projectId);
    if (currentProject && currentProject.ProjectClient !== selectedClient) {
      setProjectId('');
      setIsCustomProject(false);
    }
    if (selectedClient !== '*New') {
      setIsCustomProject(false);
      if (projectId && !projects.find((p) => p.ProjectID === projectId)) {
        setProjectId('');
      }
    }
  }, [isDelivery, selectedClient, projectId, projects]);

  useEffect(() => {
    const parsedHours = parseFloat(hours) || 0;
    if (isSales) {
      const project = salesProjects.find(
        (item) =>
          item.ProjectCode === projectCode &&
          sameLabel(item.ProjectClient, selectedClient)
      );
      onUpdate({
        taskType,
        projectId: project ? '0' : '',
        taskId: project ? '0' : '',
        hours: parsedHours,
        projectClient: selectedClient,
        projectName: project?.ProjectName ?? '',
        projectCode: project?.ProjectCode ?? '',
        taskName: project ? SALES_TASK_NAME : '',
      });
      return;
    }
    if (isOperations) {
      onUpdate({
        taskType,
        projectId: taskName ? '0' : '',
        taskId: taskName ? '0' : '',
        hours: parsedHours,
        projectClient: taskName ? SHOPSTACK_CLIENT : '',
        projectName: taskName ? INTERNAL_OPERATIONS_PROJECT_NAME : '',
        projectCode: taskName ? INTERNAL_OPERATIONS_PROJECT_CODE : '',
        taskName,
      });
      return;
    }
    if (isInternalDev) {
      onUpdate({
        taskType,
        projectId,
        taskId,
        hours: parsedHours,
        projectClient: SHOPSTACK_CLIENT,
        projectName: '',
        projectCode: '',
        taskName: '',
      });
      return;
    }
    onUpdate({
      taskType: 'project_delivery',
      projectId,
      taskId,
      hours: parsedHours,
      projectClient: selectedClient,
      projectName: '',
      projectCode: '',
      taskName: '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    taskType,
    projectId,
    taskId,
    hours,
    selectedClient,
    projectCode,
    taskName,
    salesProjects,
    isSales,
    isOperations,
    isInternalDev,
  ]);

  const handleTaskTypeChange = (value: string) => {
    setTaskType(value as TimesheetTaskType);
    setSelectedClient('');
    setProjectId('');
    setTaskId('');
    setProjectCode('');
    setTaskName('');
    setIsCustomProject(false);
    setAddingClient(false);
    setAddingProject(false);
    setNewClientName('');
    setNewProjectName('');
    setNewProjectCode('');
    setAddProjectError('');
    setTouched({ client: false, project: false, task: false, hours: false });
  };

  const handleClientChange = (value: string) => {
    setTouched((prev) => ({ ...prev, client: true }));
    setSelectedClient(value);
    setProjectId('');
    setProjectCode('');
    if (value !== '*New') {
      setIsCustomProject(false);
    }
  };

  const handleAddClient = () => {
    const name = newClientName.trim();
    if (!name) return;
    const existing = salesClientOptions.find((option) => sameLabel(option.value, name));
    if (existing) {
      setSelectedClient(existing.value);
    } else {
      setExtraClients((prev) => [...prev, name]);
      setSelectedClient(name);
    }
    setProjectCode('');
    setAddingClient(false);
    setNewClientName('');
    setTouched((prev) => ({ ...prev, client: true }));
  };

  const handleAddProject = async () => {
    const projectName = newProjectName.trim();
    const code = newProjectCode.trim();
    if (!selectedClient) {
      setAddProjectError('Select a client first');
      return;
    }
    if (!projectName || !code) {
      setAddProjectError('Project name and project code are required');
      return;
    }
    if (salesProjectCodeTaken(salesProjects.map((project) => project.ProjectCode), code)) {
      setAddProjectError(`Project code already exists: ${code}`);
      return;
    }
    setSavingProject(true);
    setAddProjectError('');
    const result = await onCreateSalesProject({
      projectClient: selectedClient,
      projectName,
      projectCode: code,
    });
    setSavingProject(false);
    if (!result.ok) {
      setAddProjectError(result.error);
      return;
    }
    setSelectedClient(result.project.ProjectClient);
    setProjectCode(result.project.ProjectCode);
    setAddingProject(false);
    setNewProjectName('');
    setNewProjectCode('');
    setTouched((prev) => ({ ...prev, project: true }));
  };

  const addButtonClass =
    'px-2.5 py-1 text-sm font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div
      className={`p-3 rounded border relative group ${
        disabled
          ? 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 opacity-60'
          : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600'
      }`}
    >
      <button
        onClick={onDelete}
        disabled={disabled}
        className={`absolute top-0 right-0 p-1.5 rounded transition-colors z-10 ${
          disabled
            ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            : 'text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30'
        }`}
        title="Remove entry"
        type="button"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="space-y-2 mt-3">
        <div>
          <div className={showLabels ? 'flex items-center gap-3' : ''}>
            {showLabels && <label className={labelClass}>Task type</label>}
            <div className="flex-1">
              <SearchableSelect
                options={TASK_TYPE_OPTIONS}
                value={taskType}
                onChange={handleTaskTypeChange}
                placeholder="Select task type"
                disabled={disabled}
              />
            </div>
          </div>
        </div>

        {isDelivery && (
          <>
            <div>
              <div className={showLabels ? 'flex items-center gap-3' : ''}>
                {showLabels && <label className={labelClass}>Client</label>}
                <div className="flex-1">
                  <SearchableSelect
                    options={deliveryClientOptions}
                    value={selectedClient}
                    onChange={handleClientChange}
                    placeholder={showLabels ? 'Select Client' : 'Select Client *'}
                    required
                    error={showErrors.client}
                    disabled={disabled}
                  />
                </div>
              </div>
              {showErrors.client && <p className={errorClass}>Client is required</p>}
            </div>

            <div>
              <div className={showLabels ? 'flex items-center gap-3' : ''}>
                {showLabels && <label className={labelClass}>Project</label>}
                <div className="flex-1 flex items-center gap-2">
                  {isCustomProject && selectedClient === '*New' ? (
                    <>
                      <input
                        type="text"
                        value={projectId}
                        onChange={(e) => {
                          setTouched((prev) => ({ ...prev, project: true }));
                          setProjectId(e.target.value);
                        }}
                        onBlur={() => setTouched((prev) => ({ ...prev, project: true }))}
                        placeholder={showLabels ? 'Enter Project Name' : 'Enter Project Name *'}
                        disabled={disabled || !selectedClient}
                        className={`flex-1 ${fieldInputClass(disabled || !selectedClient, showErrors.project)}`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomProject(false);
                          setProjectId('');
                        }}
                        disabled={disabled}
                        className="px-2 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        title="Switch back to dropdown"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      <SearchableSelect
                        options={deliveryProjectOptions}
                        value={projectId}
                        onChange={(value) => {
                          setTouched((prev) => ({ ...prev, project: true }));
                          setProjectId(value);
                          setIsCustomProject(false);
                        }}
                        placeholder={showLabels ? 'Select Project' : 'Select Project *'}
                        disabled={disabled || !selectedClient}
                        required
                        error={showErrors.project}
                        className="flex-1"
                      />
                      {selectedClient === '*New' && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsCustomProject(true);
                            setProjectId('');
                            setTouched((prev) => ({ ...prev, project: true }));
                          }}
                          disabled={disabled || !selectedClient}
                          className="px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                          title="Enter custom project name"
                        >
                          New
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {showErrors.project && <p className={errorClass}>Project is required</p>}
            </div>
          </>
        )}

        {isSales && (
          <>
            <div>
              <div className={showLabels ? 'flex items-center gap-3' : ''}>
                {showLabels && <label className={labelClass}>Client</label>}
                <div className="flex-1 flex items-center gap-2">
                  <SearchableSelect
                    options={salesClientOptions}
                    value={selectedClient}
                    onChange={handleClientChange}
                    placeholder="Select Client"
                    required
                    error={showErrors.client}
                    disabled={disabled}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    className={addButtonClass}
                    title="Add client"
                    disabled={disabled}
                    onClick={() => {
                      setAddingClient((open) => !open);
                      setAddProjectError('');
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
              {showErrors.client && <p className={errorClass}>Client is required</p>}
              {addingClient && (
                <div className={`mt-2 flex gap-2 ${showLabels ? 'ml-[calc(110px+0.75rem)]' : ''}`}>
                  <input
                    type="text"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="New client name"
                    disabled={disabled}
                    className={fieldInputClass(disabled, false)}
                  />
                  <button
                    type="button"
                    className={addButtonClass}
                    disabled={disabled || !newClientName.trim()}
                    onClick={handleAddClient}
                  >
                    Add
                  </button>
                </div>
              )}
            </div>

            <div>
              <div className={showLabels ? 'flex items-center gap-3' : ''}>
                {showLabels && <label className={labelClass}>Project</label>}
                <div className="flex-1 flex items-center gap-2">
                  {addingProject ? (
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        placeholder="Project name"
                        disabled={disabled || savingProject}
                        className={fieldInputClass(disabled, false)}
                      />
                      <input
                        type="text"
                        value={newProjectCode}
                        onChange={(e) => setNewProjectCode(e.target.value)}
                        placeholder="Project code"
                        disabled={disabled || savingProject}
                        className={fieldInputClass(disabled, Boolean(addProjectError))}
                      />
                      {addProjectError && (
                        <p className="text-xs text-red-600 dark:text-red-400">{addProjectError}</p>
                      )}
                      <button
                        type="button"
                        className={addButtonClass}
                        disabled={disabled || savingProject}
                        onClick={handleAddProject}
                      >
                        {savingProject ? 'Saving…' : 'Add project'}
                      </button>
                    </div>
                  ) : (
                    <SearchableSelect
                      options={salesProjectOptions}
                      value={projectCode}
                      onChange={(value) => {
                        setTouched((prev) => ({ ...prev, project: true }));
                        setProjectCode(value);
                      }}
                      placeholder="Select Project"
                      disabled={disabled || !selectedClient}
                      required
                      error={showErrors.project}
                      className="flex-1"
                    />
                  )}
                  <button
                    type="button"
                    className={addButtonClass}
                    title={addingProject ? 'Back to project list' : 'Add project'}
                    disabled={disabled || !selectedClient || savingProject}
                    onClick={() => {
                      setAddingProject((open) => !open);
                      setAddProjectError('');
                    }}
                  >
                    {addingProject ? '×' : '+'}
                  </button>
                </div>
              </div>
              {showErrors.project && !addingProject && <p className={errorClass}>Project is required</p>}
            </div>
          </>
        )}

        {isInternalDev && (
          <div>
            <div className={showLabels ? 'flex items-center gap-3' : ''}>
              {showLabels && <label className={labelClass}>Project</label>}
              <div className="flex-1">
                <SearchableSelect
                  options={shopstackProjectOptions}
                  value={projectId}
                  onChange={(value) => {
                    setTouched((prev) => ({ ...prev, project: true }));
                    setProjectId(value);
                  }}
                  placeholder="Select Project"
                  disabled={disabled}
                  required
                  error={showErrors.project}
                />
              </div>
            </div>
            {showErrors.project && <p className={errorClass}>Project is required</p>}
          </div>
        )}

        {(isDelivery || isInternalDev) && (
          <div>
            <div className={showLabels ? 'flex items-center gap-3' : ''}>
              {showLabels && <label className={labelClass}>Task</label>}
              <div className="flex-1">
                <SearchableSelect
                  options={taskOptions}
                  value={taskId}
                  onChange={(value) => {
                    setTouched((prev) => ({ ...prev, task: true }));
                    setTaskId(value);
                  }}
                  placeholder={showLabels ? 'Select Task' : 'Select Task *'}
                  required
                  error={showErrors.task}
                  disabled={disabled}
                />
              </div>
            </div>
            {showErrors.task && <p className={errorClass}>Task is required</p>}
          </div>
        )}

        {isOperations && (
          <div>
            <div className={showLabels ? 'flex items-center gap-3' : ''}>
              {showLabels && <label className={labelClass}>Task</label>}
              <div className="flex-1">
                <SearchableSelect
                  options={operationTaskOptions}
                  value={taskName}
                  onChange={(value) => {
                    setTouched((prev) => ({ ...prev, task: true }));
                    setTaskName(value);
                  }}
                  placeholder="Select Task"
                  required
                  error={showErrors.task}
                  disabled={disabled}
                />
              </div>
            </div>
            {showErrors.task && <p className={errorClass}>Task is required</p>}
          </div>
        )}

        <div>
          <div className={showLabels ? 'flex items-center gap-3' : ''}>
            {showLabels && <label className={labelClass}>Hours</label>}
            <div className="flex-1 relative">
              <input
                type="number"
                value={hours}
                onChange={(e) => {
                  setTouched((prev) => ({ ...prev, hours: true }));
                  setHours(e.target.value);
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, hours: true }))}
                min="0"
                max="24"
                step="0.25"
                placeholder="Hours"
                disabled={disabled}
                className={`${fieldInputClass(disabled, showErrors.hours)} pr-10`}
              />
              <span className="absolute right-2 top-1/2 transform -translate-y-1/2 text-sm text-gray-500 dark:text-gray-400 pointer-events-none">
                hr
              </span>
            </div>
          </div>
          {showErrors.hours && <p className={errorClass}>Hours must be greater than 0</p>}
        </div>
      </div>
    </div>
  );
}

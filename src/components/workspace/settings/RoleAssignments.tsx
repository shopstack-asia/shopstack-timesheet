'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWorkspaceAccess } from '@/components/workspace/layout/WorkspaceFrame';
import type { WorkspaceRoleAssignment } from '@/lib/workspace/roles';
import type { ApiResponse } from '@/types';

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !body.success || !body.data) {
    throw new Error(body.error || 'Could not load roles');
  }
  return body.data;
}

export function RoleAssignments() {
  const access = useWorkspaceAccess();
  const [assignments, setAssignments] = useState<WorkspaceRoleAssignment[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await readJson<{ assignments: WorkspaceRoleAssignment[] }>(await fetch('/api/settings/roles'));
    setAssignments(data.assignments);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load roles');
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const save = async (role: WorkspaceRoleAssignment['role'], employeeCodes: string[]) => {
    setError(null);
    setSavingRole(role);
    try {
      const data = await readJson<{ assignment: WorkspaceRoleAssignment }>(
        await fetch('/api/settings/roles', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role, employeeCodes }),
        })
      );
      setAssignments((current) =>
        (current ?? []).map((item) => (item.role === role ? data.assignment : item))
      );
      setDrafts((current) => ({ ...current, [role]: '' }));
      await access.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save roles');
    } finally {
      setSavingRole(null);
    }
  };

  const addCode = (assignment: WorkspaceRoleAssignment) => {
    const next = (drafts[assignment.role] ?? '').trim();
    if (!next || savingRole) return;
    void save(assignment.role, [...assignment.employeeCodes, next]);
  };

  if (!assignments) {
    return <p className="mt-4 text-gray-700 dark:text-gray-300">{error ?? 'Loading roles...'}</p>;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Roles & Permission</h2>
      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <ul className="mt-6 divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
        {assignments.map((assignment) => (
          <li key={assignment.role} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-medium text-gray-900 dark:text-white">{assignment.label}</p>
            <div className="flex flex-wrap items-center gap-2 sm:max-w-xl sm:justify-end">
              {assignment.employeeCodes.map((code) => (
                <span
                  key={code}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-sm text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                >
                  {code}
                  <button
                    type="button"
                    aria-label={`Remove ${code}`}
                    disabled={savingRole === assignment.role}
                    className="text-blue-700 hover:text-blue-900 disabled:opacity-50 dark:text-blue-200"
                    onClick={() => {
                      void save(
                        assignment.role,
                        assignment.employeeCodes.filter((item) => item !== code)
                      );
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                aria-label={`Add employee code for ${assignment.label}`}
                value={drafts[assignment.role] ?? ''}
                disabled={savingRole === assignment.role}
                placeholder="Employee code"
                className="w-36 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                onChange={(event) => {
                  setDrafts((current) => ({ ...current, [assignment.role]: event.target.value }));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault();
                    addCode(assignment);
                  }
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

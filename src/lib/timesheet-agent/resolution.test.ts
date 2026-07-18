import { describe, expect, it } from 'vitest';
import {
  decideProjectResolution,
  decideTaskResolution,
} from '@/lib/timesheet-agent/resolution';
import { Project, Task } from '@/types';

const projects: Project[] = [
  {
    ProjectID: '12',
    ProjectClient: 'Hertz',
    ProjectName: 'Website',
    ProjectCode: 'HZ-WEB',
  },
  {
    ProjectID: '13',
    ProjectClient: 'Hertz',
    ProjectName: 'Reservation',
    ProjectCode: 'HZ-RES',
  },
  {
    ProjectID: '20',
    ProjectClient: 'Acme',
    ProjectName: 'Portal',
    ProjectCode: 'ACM-PORTAL',
  },
];

const tasks: Task[] = [
  { TaskID: '1', Task: 'Development' },
  { TaskID: '2', Task: 'Meeting' },
  { TaskID: '3', Task: 'Dev Ops' },
];

describe('project resolution', () => {
  it('exact project id', () => {
    const r = decideProjectResolution('12', projects);
    expect(r.status).toBe('exact');
    if (r.status === 'exact') expect(r.project.ProjectID).toBe('12');
  });

  it('exact project code', () => {
    const r = decideProjectResolution('HZ-WEB', projects);
    expect(r.status).toBe('exact');
  });

  it('exact project name unique', () => {
    const r = decideProjectResolution('Portal', projects);
    expect(r.status).toBe('exact');
  });

  it('multiple Hertz matches are ambiguous', () => {
    const r = decideProjectResolution('Hertz', projects);
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') expect(r.candidates.length).toBeGreaterThan(1);
  });

  it('unknown project', () => {
    const r = decideProjectResolution('TotallyUnknownXYZ', projects);
    expect(r.status).toBe('unknown');
  });
});

describe('task resolution', () => {
  it('exact task id', () => {
    const r = decideTaskResolution('1', tasks);
    expect(r.status).toBe('exact');
  });

  it('exact task name', () => {
    const r = decideTaskResolution('Development', tasks);
    expect(r.status).toBe('exact');
  });

  it('partial Dev matches multiple', () => {
    const r = decideTaskResolution('Dev', tasks);
    expect(['ambiguous', 'exact']).toContain(r.status);
  });

  it('unknown task', () => {
    const r = decideTaskResolution('Flying', tasks);
    expect(r.status).toBe('unknown');
  });
});

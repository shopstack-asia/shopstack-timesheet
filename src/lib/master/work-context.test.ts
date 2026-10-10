import { describe, expect, it } from 'vitest';
import { toWorkContextRef } from '@/lib/master/work-context';
import { INTERNAL_OPERATIONS_PROJECT_CODE } from '@/lib/timesheet/task-type';

describe('shared work context', () => {
  it('keeps a ProjectID for project delivery and internal development', () => {
    expect(
      toWorkContextRef({
        taskType: 'project_delivery',
        projectId: '12',
        taskId: '3',
        projectCode: 'PORTAL',
      }).projectId
    ).toBe('12');
    expect(
      toWorkContextRef({
        taskType: 'internal_development',
        projectId: '44',
        taskId: '9',
        projectClient: 'Shopstack',
      })
    ).toMatchObject({ kind: 'internal_development', projectId: '44', taskId: '9' });
  });

  it('omits ProjectID for sales and internal operations', () => {
    const sales = toWorkContextRef({
      taskType: 'sales_presales',
      projectId: '0',
      taskId: '0',
      projectCode: 'ALPHA',
      taskName: 'Sales & Presales',
    });
    expect(sales.projectId).toBeUndefined();
    expect(sales.projectCode).toBe('ALPHA');

    const operations = toWorkContextRef({
      taskType: 'internal_operations',
      projectId: '0',
      taskId: '0',
      taskName: 'Admin',
    });
    expect(operations.projectId).toBeUndefined();
    expect(operations.projectCode).toBe(INTERNAL_OPERATIONS_PROJECT_CODE);
  });

  it('treats a missing task type as project delivery without inventing a ProjectID', () => {
    expect(toWorkContextRef({ projectId: '0', taskId: '0' })).toEqual({
      kind: 'project_delivery',
    });
  });
});

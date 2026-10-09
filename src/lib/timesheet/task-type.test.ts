import { describe, expect, it } from 'vitest';
import type { TimeLogRow } from '@/types';
import {
  buildTimeLogId,
  isProjectDeliveryClient,
  inferTaskType,
  isTimeEntryReady,
  operationTaskNamesFromDropdownRows,
  operationTimeLogFields,
  salesProjectCodeTaken,
  salesTimeLogFields,
  timeLogRowToTimeEntry,
  timeLogSyncKey,
  toSubmitEntryPayload,
} from '@/lib/timesheet/task-type';

function row(partial: Partial<TimeLogRow>): TimeLogRow {
  return {
    'Time Log ID': 'id',
    Date: '2026-10-05',
    'Staff ID': 'S1',
    'Staff First Name': 'A',
    'Staff Last Name': 'B',
    'Staff Position': 'Eng',
    'Project ID': '12',
    'Project Client': 'Acme',
    'Project Name': 'Portal',
    'Project Code': 'PORTAL',
    'Task ID': '3',
    Task: 'Develop',
    Hours: 2,
    ...partial,
  };
}

describe('project delivery clients', () => {
  it('hides Shopstack, *New, and *Other', () => {
    expect(isProjectDeliveryClient('AIS')).toBe(true);
    expect(isProjectDeliveryClient('*New')).toBe(false);
    expect(isProjectDeliveryClient('*Other')).toBe(false);
    expect(isProjectDeliveryClient('Shopstack')).toBe(false);
    expect(isProjectDeliveryClient('  *other  ')).toBe(false);
  });
});

describe('task type time log identity', () => {
  it('keeps the historical hash for real project and task ids', () => {
    const withoutExtras = buildTimeLogId('2026-10-05', 'S1', '12', '3');
    const withExtras = buildTimeLogId('2026-10-05', 'S1', '12', '3', 'PORTAL', 'Develop');
    expect(withExtras).toBe(withoutExtras);
    expect(timeLogSyncKey({ projectId: '12', taskId: '3', projectCode: 'PORTAL' })).toBe(
      '12|3'
    );
  });

  it('separates two sales projects that both use project id 0 and task id 0', () => {
    const alpha = buildTimeLogId('2026-10-05', 'S1', '0', '0', 'ALPHA', 'Sales & Presales');
    const beta = buildTimeLogId('2026-10-05', 'S1', '0', '0', 'BETA', 'Sales & Presales');
    expect(alpha).not.toBe(beta);
    expect(
      timeLogSyncKey({
        projectId: '0',
        taskId: '0',
        projectCode: 'ALPHA',
        taskName: 'Sales & Presales',
      })
    ).not.toBe(
      timeLogSyncKey({
        projectId: '0',
        taskId: '0',
        projectCode: 'BETA',
        taskName: 'Sales & Presales',
      })
    );
  });

  it('separates sales rows from internal operation rows', () => {
    const sales = timeLogSyncKey({
      projectId: '0',
      taskId: '0',
      projectCode: 'ALPHA',
      taskName: 'Sales & Presales',
    });
    const ops = timeLogSyncKey({
      projectId: '0',
      taskId: '0',
      projectCode: 'INTERNAL_OPERATIONS',
      taskName: 'Admin',
    });
    expect(sales).not.toBe(ops);
  });
});

describe('inferTaskType', () => {
  it('classifies sales, operations, shopstack delivery, and other projects', () => {
    expect(
      inferTaskType(
        row({
          'Project ID': '0',
          'Task ID': '0',
          Task: 'Sales & Presales',
          'Project Code': 'ALPHA',
        })
      )
    ).toBe('sales_presales');
    expect(
      inferTaskType(
        row({
          'Project ID': '0',
          'Task ID': '0',
          'Project Client': 'Shopstack',
          'Project Name': 'Internal Operations',
          'Project Code': 'INTERNAL_OPERATIONS',
          Task: 'Admin',
        })
      )
    ).toBe('internal_operations');
    expect(
      inferTaskType(row({ 'Project Client': 'Shopstack', 'Project ID': '44' }))
    ).toBe('internal_development');
    expect(inferTaskType(row({ 'Project Client': 'Acme' }))).toBe('project_delivery');
  });

  it('maps a sales row back to the form fields', () => {
    const entry = timeLogRowToTimeEntry(
      row({
        'Time Log ID': 'abc',
        'Project ID': '0',
        'Project Client': 'Contoso',
        'Project Name': 'Pitch',
        'Project Code': 'PITCH',
        'Task ID': '0',
        Task: 'Sales & Presales',
        Hours: 1.5,
      })
    );
    expect(entry).toMatchObject({
      id: 'abc',
      taskType: 'sales_presales',
      projectCode: 'PITCH',
      projectClient: 'Contoso',
      taskName: 'Sales & Presales',
      hours: 1.5,
    });
  });
});

describe('time log field builders', () => {
  it('writes sales rows with id 0 and the sales task name', () => {
    expect(
      salesTimeLogFields({
        ProjectClient: 'Contoso',
        ProjectName: 'Pitch',
        ProjectCode: 'PITCH',
      })
    ).toEqual({
      projectId: '0',
      projectClient: 'Contoso',
      projectName: 'Pitch',
      projectCode: 'PITCH',
      taskId: '0',
      taskName: 'Sales & Presales',
    });
  });

  it('writes internal operations with the fixed Shopstack project and the chosen task', () => {
    expect(operationTimeLogFields('Payroll')).toEqual({
      projectId: '0',
      projectClient: 'Shopstack',
      projectName: 'Internal Operations',
      projectCode: 'INTERNAL_OPERATIONS',
      taskId: '0',
      taskName: 'Payroll',
    });
  });
});

describe('sales project codes and operation tasks', () => {
  it('rejects a duplicate project code ignoring case and surrounding space', () => {
    expect(salesProjectCodeTaken([' Alpha '], 'alpha')).toBe(true);
    expect(salesProjectCodeTaken(['Alpha'], 'BETA')).toBe(false);
  });

  it('reads the Operation Task column from the Dropdown sheet', () => {
    expect(
      operationTaskNamesFromDropdownRows([
        ['Ignore', 'Operation Task', 'Other'],
        ['x', 'Payroll', ''],
        ['x', '  ', ''],
        ['x', 'payroll', ''],
        ['x', 'Admin', ''],
      ])
    ).toEqual(['Payroll', 'Admin']);
  });

  it('fails when the Operation Task column is missing', () => {
    expect(() => operationTaskNamesFromDropdownRows([['Client', 'Name']])).toThrow(
      /Operation Task/
    );
  });
});

describe('entry readiness and submit payload', () => {
  it('requires hours plus the fields for each task type', () => {
    expect(isTimeEntryReady({ taskType: 'project_delivery', projectId: '1', taskId: '2', hours: 1 })).toBe(
      true
    );
    expect(isTimeEntryReady({ taskType: 'sales_presales', projectClient: 'A', projectCode: 'C', hours: 1 })).toBe(
      true
    );
    expect(isTimeEntryReady({ taskType: 'sales_presales', projectClient: 'A', hours: 1 })).toBe(false);
    expect(isTimeEntryReady({ taskType: 'internal_operations', taskName: 'Admin', hours: 0 })).toBe(
      false
    );
    expect(isTimeEntryReady({ taskType: 'internal_development', projectId: '9', taskId: '2', hours: 1 })).toBe(
      true
    );
  });

  it('sends project id 0 and task id 0 for sales and operations', () => {
    expect(
      toSubmitEntryPayload({
        id: '1',
        taskType: 'sales_presales',
        projectId: '',
        taskId: '',
        hours: 2,
        projectCode: 'PITCH',
        projectClient: 'Contoso',
        projectName: 'Pitch',
        taskName: 'Sales & Presales',
      })
    ).toMatchObject({ projectId: '0', taskId: '0', projectCode: 'PITCH' });
  });
});

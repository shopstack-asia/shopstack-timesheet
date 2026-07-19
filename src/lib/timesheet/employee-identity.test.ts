import { describe, expect, it } from 'vitest';
import {
  staffProfileToTimesheetEmployeeRecord,
  verifyTimesheetEmployeeIdentity,
  TIMESHEET_STAFF_IDENTITY_TYPE,
  TimesheetEmployeeIdentityError,
} from '@/lib/timesheet/employee-identity';

describe('staffProfileToTimesheetEmployeeRecord', () => {
  it('maps Zoho EmployeeID as Timesheet Staff identity', () => {
    const record = staffProfileToTimesheetEmployeeRecord({
      EmployeeID: 'S0005',
      FirstName: 'Prakasit',
      LastName: 'Kitrakham',
      Nickname: '',
      Email: 'prakasit@shopstack.asia',
      Position: 'CTO',
    });
    expect(record).toEqual({
      timesheetIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
      timesheetIdentityValue: 'S0005',
      email: 'prakasit@shopstack.asia',
      employeeName: 'Prakasit Kitrakham',
    });
  });
});

describe('verifyTimesheetEmployeeIdentity', () => {
  it('matches Conversation Context to Zoho EmployeeID', async () => {
    const result = await verifyTimesheetEmployeeIdentity(
      { employeeId: 'S0005', slackEmail: 'prakasit@shopstack.asia' },
      async () => ({
        timesheetIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
        timesheetIdentityValue: 'S0005',
        email: 'prakasit@shopstack.asia',
        employeeName: 'Prakasit Kitrakham',
      })
    );
    expect(result.timesheetIdentityStatus).toBe('matched');
    expect(result.timesheetIdentityMatched).toBe(true);
  });

  it('reports mismatch without secrets', async () => {
    const result = await verifyTimesheetEmployeeIdentity(
      { employeeId: 'S0005', slackEmail: 'prakasit@shopstack.asia' },
      async () => ({
        timesheetIdentityType: 'internalEmployeeId',
        timesheetIdentityValue: '707161000000285001',
        email: 'prakasit@shopstack.asia',
      })
    );
    expect(result.timesheetIdentityStatus).toBe('mismatch');
    expect(result.diagnosticMessage).not.toMatch(/Bearer|token|secret/i);
  });

  it('not_found vs unavailable', async () => {
    const missing = await verifyTimesheetEmployeeIdentity(
      { employeeId: 'S0005', slackEmail: 'prakasit@shopstack.asia' },
      async () => null
    );
    expect(missing.timesheetIdentityStatus).toBe('not_found');

    const down = await verifyTimesheetEmployeeIdentity(
      { employeeId: 'S0005', slackEmail: 'prakasit@shopstack.asia' },
      async () => {
        throw new TimesheetEmployeeIdentityError('timeout', 'unavailable');
      }
    );
    expect(down.timesheetIdentityStatus).toBe('unavailable');
    expect(down.diagnosticMessage).not.toMatch(/mismatch/i);
  });
});

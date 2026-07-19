import { describe, expect, it } from 'vitest';
import {
  deriveTimesheetStaffIdentity,
  TIMESHEET_STAFF_IDENTITY_TYPE,
} from '@/lib/timesheet/timesheet-staff-identity';

describe('deriveTimesheetStaffIdentity', () => {
  it('derives zoho_EmployeeID Staff ID from Conversation Context employeeId', () => {
    expect(deriveTimesheetStaffIdentity({ employeeId: 'S0005' })).toEqual({
      ok: true,
      identity: {
        identityType: TIMESHEET_STAFF_IDENTITY_TYPE,
        staffId: 'S0005',
      },
    });
  });

  it('rejects blank employeeId', () => {
    expect(deriveTimesheetStaffIdentity({ employeeId: '' }).ok).toBe(false);
    expect(deriveTimesheetStaffIdentity({ employeeId: '  ' }).ok).toBe(false);
    expect(deriveTimesheetStaffIdentity({}).ok).toBe(false);
  });
});

/**
 * Canonical Timesheet Staff ID contract (pure — no network I/O).
 *
 * Google Sheets Time Log rows are filtered by column "Staff ID".
 * That value is the Zoho EmployeeID from Conversation Context
 * (same as AgentAuthContext.staff.EmployeeID).
 */

export const TIMESHEET_STAFF_IDENTITY_TYPE = 'zoho_EmployeeID' as const;

export type TimesheetStaffIdentity = {
  identityType: typeof TIMESHEET_STAFF_IDENTITY_TYPE;
  staffId: string;
};

export type DeriveTimesheetStaffIdentityResult =
  | { ok: true; identity: TimesheetStaffIdentity }
  | {
      ok: false;
      identityType: typeof TIMESHEET_STAFF_IDENTITY_TYPE;
      reason: 'missing';
    };

/**
 * Derive the Staff ID the canonical Timesheet reader will use.
 * Pure: no Zoho, Slack, or Sheets calls.
 */
export function deriveTimesheetStaffIdentity(input: {
  employeeId?: string | null;
}): DeriveTimesheetStaffIdentityResult {
  const staffId = String(input.employeeId ?? '').trim();
  if (!staffId) {
    return {
      ok: false,
      identityType: TIMESHEET_STAFF_IDENTITY_TYPE,
      reason: 'missing',
    };
  }
  return {
    ok: true,
    identity: {
      identityType: TIMESHEET_STAFF_IDENTITY_TYPE,
      staffId,
    },
  };
}

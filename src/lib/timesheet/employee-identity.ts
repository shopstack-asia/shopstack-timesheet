/**
 * Canonical Timesheet employee identity verification.
 *
 * Weekly Timesheet UI and Time Log rows identify staff by Zoho EmployeeID
 * stored as Google Sheets Time Log "Staff ID". This module re-looks up the
 * employee via the same Zoho email path used by NextAuth / Slack identity
 * resolution — without inventing a /v1/me endpoint or scanning Time Log entries.
 */

import { getZohoPeopleService } from '@/lib/zoho-people';
import type { StaffProfile } from '@/types';

/** Identifier type used by Google Sheets Time Log Staff ID filter. */
export const TIMESHEET_STAFF_IDENTITY_TYPE = 'zoho_EmployeeID' as const;

export type TimesheetIdentityStatus =
  | 'matched'
  | 'not_found'
  | 'mismatch'
  | 'unavailable';

export type TimesheetEmployeeRecord = {
  /** Value used as Time Log Staff ID (normally Zoho EmployeeID). */
  timesheetIdentityValue: string;
  /** Diagnostic label for that identifier. */
  timesheetIdentityType: string;
  email: string;
  employeeName?: string;
};

export type VerifyTimesheetEmployeeIdentityInput = {
  /** Conversation Context Zoho EmployeeID */
  employeeId: string;
  /** Conversation Context email */
  slackEmail: string;
};

export type VerifyTimesheetEmployeeIdentityResult = {
  timesheetIdentityType: string;
  timesheetIdentityValue?: string;
  timesheetIdentityMatched: boolean;
  timesheetIdentityStatus: TimesheetIdentityStatus;
  diagnosticMessage: string;
  employeeName?: string;
};

export type TimesheetEmployeeLookup = (
  email: string
) => Promise<TimesheetEmployeeRecord | null>;

export class TimesheetEmployeeIdentityError extends Error {
  readonly code: 'unavailable' | 'validation';

  constructor(message: string, code: 'unavailable' | 'validation' = 'unavailable') {
    super(message);
    this.name = 'TimesheetEmployeeIdentityError';
    this.code = code;
  }
}

export function staffProfileToTimesheetEmployeeRecord(
  staff: StaffProfile
): TimesheetEmployeeRecord | null {
  const employeeId = String(staff.EmployeeID || '').trim();
  const email = String(staff.Email || '').trim().toLowerCase();
  if (!employeeId || !email) return null;
  const first = String(staff.FirstName || '').trim();
  const last = String(staff.LastName || '').trim();
  const employeeName = `${first} ${last}`.trim() || undefined;
  return {
    timesheetIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
    timesheetIdentityValue: employeeId,
    email,
    employeeName,
  };
}

export function createZohoTimesheetEmployeeLookup(): TimesheetEmployeeLookup {
  return async (email: string) => {
    try {
      const staff = await getZohoPeopleService().getEmployeeByEmail(email);
      if (!staff) return null;
      return staffProfileToTimesheetEmployeeRecord(staff);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/timeout|ETIMEDOUT|AbortError/i.test(message)) {
        throw new TimesheetEmployeeIdentityError(
          'The employee identity service did not respond in time',
          'unavailable'
        );
      }
      throw new TimesheetEmployeeIdentityError(
        'Employee identity service is temporarily unavailable',
        'unavailable'
      );
    }
  };
}

/**
 * Compare Conversation Context identity to the canonical Timesheet employee record
 * (Zoho EmployeeID ↔ Time Log Staff ID).
 */
export async function verifyTimesheetEmployeeIdentity(
  input: VerifyTimesheetEmployeeIdentityInput,
  lookup?: TimesheetEmployeeLookup
): Promise<VerifyTimesheetEmployeeIdentityResult> {
  const employeeId = input.employeeId?.trim() || '';
  const slackEmail = input.slackEmail?.trim().toLowerCase() || '';
  if (!employeeId || !slackEmail) {
    return {
      timesheetIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
      timesheetIdentityMatched: false,
      timesheetIdentityStatus: 'not_found',
      diagnosticMessage:
        'Conversation Context is missing employeeId or email required for Timesheet identity verification.',
    };
  }

  const resolve = lookup ?? createZohoTimesheetEmployeeLookup();

  try {
    const record = await resolve(slackEmail);
    if (!record) {
      return {
        timesheetIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
        timesheetIdentityMatched: false,
        timesheetIdentityStatus: 'not_found',
        diagnosticMessage:
          'No Timesheet employee record was found for the Conversation Context email. This is an identity mapping issue, not missing timesheet entries.',
      };
    }

    const value = String(record.timesheetIdentityValue || '').trim();
    const type = record.timesheetIdentityType || TIMESHEET_STAFF_IDENTITY_TYPE;
    const matched = value === employeeId;

    if (matched) {
      return {
        timesheetIdentityType: type,
        timesheetIdentityValue: value,
        timesheetIdentityMatched: true,
        timesheetIdentityStatus: 'matched',
        diagnosticMessage:
          'Conversation Context employee identity matches the Timesheet employee record (Zoho EmployeeID = Time Log Staff ID).',
        employeeName: record.employeeName,
      };
    }

    return {
      timesheetIdentityType: type,
      timesheetIdentityValue: value,
      timesheetIdentityMatched: false,
      timesheetIdentityStatus: 'mismatch',
      diagnosticMessage: `Conversation Context uses Zoho Employee ID ${employeeId}, but the Timesheet data source uses a different identifier (${type}=${value}).`,
      employeeName: record.employeeName,
    };
  } catch (error) {
    if (error instanceof TimesheetEmployeeIdentityError) {
      return {
        timesheetIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
        timesheetIdentityMatched: false,
        timesheetIdentityStatus: 'unavailable',
        diagnosticMessage: error.message,
      };
    }
    return {
      timesheetIdentityType: TIMESHEET_STAFF_IDENTITY_TYPE,
      timesheetIdentityMatched: false,
      timesheetIdentityStatus: 'unavailable',
      diagnosticMessage:
        'Employee identity verification could not run because the identity service is unavailable.',
    };
  }
}

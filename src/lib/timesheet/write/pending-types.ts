/**
 * Pending Timesheet Change — server-side confirmation state.
 * Production store is Redis (shared across serverless instances).
 * In-memory Map is test-only and must never be the production default.
 */

export type TimesheetWriteOperation =
  | 'create_entry'
  | 'update_entry'
  | 'delete_entry'
  | 'submit_timesheet';

export type PendingChangeStatus =
  | 'pending'
  | 'executing'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'conflict'
  | 'failed';

/** Normalized entry used for snapshots and writes (no display-only fields). */
export type SnapshotEntry = {
  id?: string;
  projectId: string;
  taskId: string;
  hours: number;
};

export type DaySnapshot = {
  date: string;
  entries: SnapshotEntry[];
};

export type PendingTimesheetChange = {
  confirmationId: string;
  operation: TimesheetWriteOperation;
  conversationId: string;
  slackUserId: string;
  employeeId: string;
  date?: string;
  weekStart?: string;
  originalSnapshot: DaySnapshot;
  originalSnapshotHash: string;
  proposedSnapshot: DaySnapshot;
  proposedSnapshotHash: string;
  /** Safe human-readable confirmation text for the model/user */
  summary: string;
  /** Structured summary fields for UI/tests */
  summaryPayload: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
  status: PendingChangeStatus;
  requestId?: string;
  sourceEventId?: string;
  /** When status became executing (lease / crash recovery). */
  claimedAt?: Date;
  /**
   * Fencing token for execution ownership.
   * Incremented on each claim/reclaim. Finalizers must present the matching version.
   * 0 while pending / never claimed.
   */
  executionVersion: number;
  completedAt?: Date;
  resultSnapshotHash?: string;
  safeError?: string;
  /** Stored on success so Slack retries return the same completed payload. */
  completedResult?: ConfirmTimesheetChangeResult;
  /** Entries to submit via submitDayTimesheetForStaff (derived from proposedSnapshot) */
  writeEntries: Array<{ projectId: string; taskId: string; hours: number }>;
};

/** Pending confirmation TTL (10 minutes). */
export const PENDING_CHANGE_TTL_MS = 10 * 60 * 1000;
export const PENDING_CHANGE_TTL_SECONDS = 10 * 60;

/** Keep completed results available for Slack retries. */
export const COMPLETED_RETENTION_SECONDS = 30 * 60;

/**
 * Executing lease: if claim is older than this and no completed result,
 * confirm may attempt crash recovery (reconcile / controlled retry).
 */
export const EXECUTING_LEASE_MS = 90 * 1000;

export type PrepareTimesheetChangeResult =
  | {
      status: 'confirmation_required';
      confirmationId: string;
      operation: TimesheetWriteOperation;
      date?: string;
      summary: Record<string, unknown>;
      confirmationMessage: string;
    }
  | {
      status: 'clarification_required';
      message: string;
      candidates?: Array<Record<string, string>>;
    }
  | {
      status: 'duplicate_found';
      message: string;
      existingEntryId?: string;
      date: string;
    }
  | {
      status: 'validation_failed';
      message: string;
    }
  | {
      status: 'unavailable';
      message: string;
    }
  | {
      status: 'unsupported';
      message: string;
    };

export type ConfirmTimesheetChangeResult =
  | {
      status: 'completed';
      operation: TimesheetWriteOperation;
      date: string;
      verified: {
        entries: Array<{
          clientName?: string;
          projectName?: string;
          taskName?: string;
          hours: number;
        }>;
        totalHours: number;
      };
      message: string;
    }
  | {
      status:
        | 'conflict'
        | 'expired'
        | 'cancelled'
        | 'already_completed'
        | 'already_processing'
        | 'failed'
        | 'unavailable';
      message: string;
    };

export type CancelTimesheetChangeResult =
  | {
      status: 'cancelled';
      confirmationId: string;
      message: string;
    }
  | {
      status:
        | 'no_pending_change'
        | 'already_completed'
        | 'expired'
        | 'unavailable';
      message: string;
    };

export const INCOMPLETE_DAY_SAFE_MESSAGE =
  'ไม่สามารถแก้ไข Timesheet วันนี้ได้อัตโนมัติ เนื่องจากข้อมูลที่มีอยู่ไม่ครบถ้วน กรุณาตรวจสอบในหน้า Weekly Timesheet ครับ';

export const STORE_UNAVAILABLE_SAFE_MESSAGE =
  'ระบบยืนยัน Timesheet ใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งครับ ยังไม่มีการเปลี่ยนแปลงข้อมูล';

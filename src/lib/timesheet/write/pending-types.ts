/**
 * Pending Timesheet Change — server-side confirmation state.
 * In-memory store is NOT safe across multiple app instances (use Redis before horizontal scale).
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
  completedAt?: Date;
  resultSnapshotHash?: string;
  safeError?: string;
  /** Stored on success so Slack retries return the same completed payload. */
  completedResult?: ConfirmTimesheetChangeResult;
  /** Entries to submit via submitDayTimesheetForStaff (derived from proposedSnapshot) */
  writeEntries: Array<{ projectId: string; taskId: string; hours: number }>;
};

export const PENDING_CHANGE_TTL_MS = 10 * 60 * 1000;

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
        | 'failed';
      message: string;
    };

export type CancelTimesheetChangeResult =
  | {
      status: 'cancelled';
      confirmationId: string;
      message: string;
    }
  | {
      status: 'no_pending_change' | 'already_completed' | 'expired';
      message: string;
    };

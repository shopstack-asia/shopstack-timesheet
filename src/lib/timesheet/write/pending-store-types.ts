import type {
  PendingChangeStatus,
  PendingTimesheetChange,
} from '@/lib/timesheet/write/pending-types';

export class PendingStoreError extends Error {
  readonly code: 'REDIS_UNAVAILABLE' | 'CREATE_CONFLICT' | 'UNEXPECTED';

  constructor(
    code: 'REDIS_UNAVAILABLE' | 'CREATE_CONFLICT' | 'UNEXPECTED',
    message: string
  ) {
    super(message);
    this.name = 'PendingStoreError';
    this.code = code;
  }
}

export type CreatePendingInput = Omit<
  PendingTimesheetChange,
  'createdAt' | 'expiresAt' | 'status' | 'claimedAt' | 'completedAt'
> & {
  status?: PendingChangeStatus;
  ttlMs?: number;
};

/**
 * Shared pending-change store. Production uses Redis.
 * Methods are async so serverless prepare/confirm share durable state.
 */
export type PendingTimesheetChangeStore = {
  create(change: CreatePendingInput): Promise<PendingTimesheetChange>;
  get(confirmationId: string): Promise<PendingTimesheetChange | undefined>;
  /**
   * Atomically transition pending → executing.
   * Returns null if not claimable (wrong status / expired / missing).
   */
  claimForExecution(
    confirmationId: string
  ): Promise<PendingTimesheetChange | null>;
  /**
   * Reclaim a stale executing claim for crash recovery (lease expired).
   * Only succeeds when status is executing and claimedAt is older than leaseMs.
   */
  reclaimStaleExecution(
    confirmationId: string,
    leaseMs: number
  ): Promise<PendingTimesheetChange | null>;
  markCompleted(
    confirmationId: string,
    result: {
      resultSnapshotHash: string;
      completedResult?: PendingTimesheetChange['completedResult'];
      retentionSeconds?: number;
    }
  ): Promise<PendingTimesheetChange | undefined>;
  markCancelled(
    confirmationId: string
  ): Promise<PendingTimesheetChange | undefined>;
  markConflict(
    confirmationId: string
  ): Promise<PendingTimesheetChange | undefined>;
  markFailed(
    confirmationId: string,
    safeError: string
  ): Promise<PendingTimesheetChange | undefined>;
  findPendingByConversation(
    conversationId: string
  ): Promise<PendingTimesheetChange[]>;
};

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
  | 'createdAt'
  | 'expiresAt'
  | 'status'
  | 'claimedAt'
  | 'completedAt'
  | 'executionVersion'
> & {
  status?: PendingChangeStatus;
  ttlMs?: number;
  executionVersion?: number;
};

/**
 * Result of a fenced finalize transition (completed / failed / conflict).
 * Redis (or memory CAS) is authoritative — never invent success locally.
 */
export type FenceTransitionResult =
  | { ok: true; change: PendingTimesheetChange }
  | {
      ok: false;
      reason: 'ownership_lost' | 'missing' | 'wrong_status';
      change?: PendingTimesheetChange;
    };

/**
 * Shared pending-change store. Production uses Redis.
 * Methods are async so serverless prepare/confirm share durable state.
 */
export type PendingTimesheetChangeStore = {
  create(change: CreatePendingInput): Promise<PendingTimesheetChange>;
  get(confirmationId: string): Promise<PendingTimesheetChange | undefined>;
  /**
   * Atomically transition pending → executing and bump executionVersion.
   * Returns null if not claimable (wrong status / expired / missing).
   */
  claimForExecution(
    confirmationId: string
  ): Promise<PendingTimesheetChange | null>;
  /**
   * Reclaim a stale executing claim (lease expired) and bump executionVersion.
   */
  reclaimStaleExecution(
    confirmationId: string,
    leaseMs: number
  ): Promise<PendingTimesheetChange | null>;
  /**
   * Atomic check: status=executing AND executionVersion matches.
   * Used immediately before Google Sheets write.
   */
  assertExecutionOwnership(
    confirmationId: string,
    executionVersion: number
  ): Promise<boolean>;
  markCompleted(
    confirmationId: string,
    executionVersion: number,
    result: {
      resultSnapshotHash: string;
      completedResult?: PendingTimesheetChange['completedResult'];
      retentionSeconds?: number;
    }
  ): Promise<FenceTransitionResult>;
  markCancelled(
    confirmationId: string
  ): Promise<PendingTimesheetChange | undefined>;
  markConflict(
    confirmationId: string,
    executionVersion: number
  ): Promise<FenceTransitionResult>;
  markFailed(
    confirmationId: string,
    executionVersion: number,
    safeError: string
  ): Promise<FenceTransitionResult>;
  findPendingByConversation(
    conversationId: string
  ): Promise<PendingTimesheetChange[]>;
};

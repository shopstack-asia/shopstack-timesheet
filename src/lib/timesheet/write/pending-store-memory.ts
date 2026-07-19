import {
  COMPLETED_RETENTION_SECONDS,
  PENDING_CHANGE_TTL_MS,
  type PendingTimesheetChange,
} from '@/lib/timesheet/write/pending-types';
import {
  PendingStoreError,
  type CreatePendingInput,
  type PendingTimesheetChangeStore,
} from '@/lib/timesheet/write/pending-store-types';
import {
  buildPendingFromCreateInput,
  clonePending,
} from '@/lib/timesheet/write/pending-serialize';

/**
 * In-memory pending store with compare-and-set semantics.
 * TEST DOUBLE ONLY — never used as the production default.
 * Safe for unit tests that need a shared Map across logical "instances"
 * when the same store object is injected into both prepare and confirm.
 */
export function createInMemoryPendingTimesheetChangeStore(): PendingTimesheetChangeStore {
  const byId = new Map<string, PendingTimesheetChange>();
  const byConversation = new Map<string, Set<string>>();

  function indexAdd(change: PendingTimesheetChange): void {
    let set = byConversation.get(change.conversationId);
    if (!set) {
      set = new Set();
      byConversation.set(change.conversationId, set);
    }
    set.add(change.confirmationId);
  }

  return {
    async create(input: CreatePendingInput) {
      if (byId.has(input.confirmationId)) {
        throw new PendingStoreError(
          'CREATE_CONFLICT',
          'Confirmation id already exists'
        );
      }
      const change = buildPendingFromCreateInput(input);
      byId.set(change.confirmationId, change);
      indexAdd(change);
      return clonePending(change);
    },

    async get(confirmationId) {
      const raw = byId.get(confirmationId);
      if (!raw) return undefined;
      if (
        raw.status === 'pending' &&
        raw.expiresAt.getTime() <= Date.now()
      ) {
        const expired = { ...raw, status: 'expired' as const };
        byId.set(confirmationId, expired);
        return clonePending(expired);
      }
      return clonePending(raw);
    },

    async claimForExecution(confirmationId) {
      const raw = byId.get(confirmationId);
      if (!raw) return null;
      if (
        raw.status === 'pending' &&
        raw.expiresAt.getTime() <= Date.now()
      ) {
        byId.set(confirmationId, { ...raw, status: 'expired' });
        return null;
      }
      if (raw.status !== 'pending') return null;
      const claimed: PendingTimesheetChange = {
        ...raw,
        status: 'executing',
        claimedAt: new Date(),
      };
      byId.set(confirmationId, claimed);
      return clonePending(claimed);
    },

    async reclaimStaleExecution(confirmationId, leaseMs) {
      const raw = byId.get(confirmationId);
      if (!raw || raw.status !== 'executing' || !raw.claimedAt) return null;
      if (Date.now() - raw.claimedAt.getTime() < leaseMs) return null;
      const claimed: PendingTimesheetChange = {
        ...raw,
        claimedAt: new Date(),
      };
      byId.set(confirmationId, claimed);
      return clonePending(claimed);
    },

    async markCompleted(confirmationId, result) {
      const raw = byId.get(confirmationId);
      if (!raw) return undefined;
      if (raw.status !== 'executing' && raw.status !== 'pending') {
        return clonePending(raw);
      }
      const next: PendingTimesheetChange = {
        ...raw,
        status: 'completed',
        completedAt: new Date(),
        resultSnapshotHash: result.resultSnapshotHash,
        completedResult: result.completedResult,
        // Extend logical retention (in-memory keeps until process ends)
        expiresAt: new Date(
          Date.now() +
            (result.retentionSeconds ?? COMPLETED_RETENTION_SECONDS) * 1000
        ),
      };
      byId.set(confirmationId, next);
      return clonePending(next);
    },

    async markCancelled(confirmationId) {
      const raw = byId.get(confirmationId);
      if (!raw) return undefined;
      if (raw.status !== 'pending') return clonePending(raw);
      const next: PendingTimesheetChange = { ...raw, status: 'cancelled' };
      byId.set(confirmationId, next);
      return clonePending(next);
    },

    async markConflict(confirmationId) {
      const raw = byId.get(confirmationId);
      if (!raw) return undefined;
      const next: PendingTimesheetChange = { ...raw, status: 'conflict' };
      byId.set(confirmationId, next);
      return clonePending(next);
    },

    async markFailed(confirmationId, safeError) {
      const raw = byId.get(confirmationId);
      if (!raw) return undefined;
      const next: PendingTimesheetChange = {
        ...raw,
        status: 'failed',
        safeError,
      };
      byId.set(confirmationId, next);
      return clonePending(next);
    },

    async findPendingByConversation(conversationId) {
      const ids = byConversation.get(conversationId);
      if (!ids) return [];
      const out: PendingTimesheetChange[] = [];
      for (const id of ids) {
        const c = await this.get(id);
        if (
          c &&
          c.conversationId === conversationId &&
          c.status === 'pending' &&
          c.expiresAt.getTime() > Date.now()
        ) {
          out.push(c);
        }
      }
      return out;
    },
  };
}

/** @deprecated Use createInMemoryPendingTimesheetChangeStore in tests only. */
export function createPendingTimesheetChangeStore(): PendingTimesheetChangeStore {
  return createInMemoryPendingTimesheetChangeStore();
}

void PENDING_CHANGE_TTL_MS;

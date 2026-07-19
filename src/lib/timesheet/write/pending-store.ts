import {
  PENDING_CHANGE_TTL_MS,
  type PendingChangeStatus,
  type PendingTimesheetChange,
} from '@/lib/timesheet/write/pending-types';

export type PendingTimesheetChangeStore = {
  create(
    change: Omit<PendingTimesheetChange, 'createdAt' | 'expiresAt' | 'status'> & {
      status?: PendingChangeStatus;
      ttlMs?: number;
    }
  ): PendingTimesheetChange;
  get(confirmationId: string): PendingTimesheetChange | undefined;
  /** Atomically transition pending → executing. Returns null if not claimable. */
  claimForExecution(confirmationId: string): PendingTimesheetChange | null;
  markCompleted(
    confirmationId: string,
    result: {
      resultSnapshotHash: string;
      completedResult?: PendingTimesheetChange['completedResult'];
    }
  ): PendingTimesheetChange | undefined;
  markCancelled(confirmationId: string): PendingTimesheetChange | undefined;
  markConflict(confirmationId: string): PendingTimesheetChange | undefined;
  markFailed(
    confirmationId: string,
    safeError: string
  ): PendingTimesheetChange | undefined;
  deleteExpired(now?: Date): number;
  findPendingByConversation(conversationId: string): PendingTimesheetChange[];
};

function cloneChange(c: PendingTimesheetChange): PendingTimesheetChange {
  return {
    ...c,
    originalSnapshot: {
      date: c.originalSnapshot.date,
      entries: c.originalSnapshot.entries.map((e) => ({ ...e })),
    },
    proposedSnapshot: {
      date: c.proposedSnapshot.date,
      entries: c.proposedSnapshot.entries.map((e) => ({ ...e })),
    },
    summaryPayload: { ...c.summaryPayload },
    writeEntries: c.writeEntries.map((e) => ({ ...e })),
    completedResult: c.completedResult
      ? ({ ...c.completedResult } as PendingTimesheetChange['completedResult'])
      : undefined,
    createdAt: new Date(c.createdAt),
    expiresAt: new Date(c.expiresAt),
    completedAt: c.completedAt ? new Date(c.completedAt) : undefined,
  };
}

function isExpired(c: PendingTimesheetChange, now: Date): boolean {
  return c.expiresAt.getTime() <= now.getTime();
}

/**
 * In-process pending store with TTL.
 * NOT horizontally distributed — document Redis requirement before multi-instance deploy.
 */
export function createPendingTimesheetChangeStore(): PendingTimesheetChangeStore {
  const byId = new Map<string, PendingTimesheetChange>();

  function refreshExpiry(c: PendingTimesheetChange, now: Date): PendingTimesheetChange {
    if (c.status === 'pending' && isExpired(c, now)) {
      const next = { ...c, status: 'expired' as const };
      byId.set(c.confirmationId, next);
      return next;
    }
    return c;
  }

  return {
    create(input) {
      const now = new Date();
      const ttl = input.ttlMs ?? PENDING_CHANGE_TTL_MS;
      const change: PendingTimesheetChange = {
        ...input,
        status: input.status ?? 'pending',
        createdAt: now,
        expiresAt: new Date(now.getTime() + ttl),
      };
      byId.set(change.confirmationId, change);
      return cloneChange(change);
    },

    get(confirmationId) {
      const now = new Date();
      const raw = byId.get(confirmationId);
      if (!raw) return undefined;
      return cloneChange(refreshExpiry(raw, now));
    },

    claimForExecution(confirmationId) {
      const now = new Date();
      const raw = byId.get(confirmationId);
      if (!raw) return null;
      const current = refreshExpiry(raw, now);
      if (current.status !== 'pending') return null;
      if (isExpired(current, now)) {
        byId.set(confirmationId, { ...current, status: 'expired' });
        return null;
      }
      const claimed: PendingTimesheetChange = {
        ...current,
        status: 'executing',
      };
      byId.set(confirmationId, claimed);
      return cloneChange(claimed);
    },

    markCompleted(confirmationId, result) {
      const raw = byId.get(confirmationId);
      if (!raw) return undefined;
      const next: PendingTimesheetChange = {
        ...raw,
        status: 'completed',
        completedAt: new Date(),
        resultSnapshotHash: result.resultSnapshotHash,
        completedResult: result.completedResult,
      };
      byId.set(confirmationId, next);
      return cloneChange(next);
    },

    markCancelled(confirmationId) {
      const raw = byId.get(confirmationId);
      if (!raw) return undefined;
      if (raw.status !== 'pending' && raw.status !== 'executing') {
        return cloneChange(raw);
      }
      const next: PendingTimesheetChange = { ...raw, status: 'cancelled' };
      byId.set(confirmationId, next);
      return cloneChange(next);
    },

    markConflict(confirmationId) {
      const raw = byId.get(confirmationId);
      if (!raw) return undefined;
      const next: PendingTimesheetChange = { ...raw, status: 'conflict' };
      byId.set(confirmationId, next);
      return cloneChange(next);
    },

    markFailed(confirmationId, safeError) {
      const raw = byId.get(confirmationId);
      if (!raw) return undefined;
      const next: PendingTimesheetChange = {
        ...raw,
        status: 'failed',
        safeError,
      };
      byId.set(confirmationId, next);
      return cloneChange(next);
    },

    deleteExpired(now = new Date()) {
      let n = 0;
      for (const [id, c] of byId) {
        if (
          (c.status === 'pending' && isExpired(c, now)) ||
          c.status === 'expired' ||
          c.status === 'completed' ||
          c.status === 'cancelled' ||
          c.status === 'conflict' ||
          c.status === 'failed'
        ) {
          // Soft-expire pending; prune terminal older than TTL*2
          if (c.status === 'pending' && isExpired(c, now)) {
            byId.set(id, { ...c, status: 'expired' });
            n += 1;
          } else if (
            c.createdAt.getTime() < now.getTime() - PENDING_CHANGE_TTL_MS * 2
          ) {
            byId.delete(id);
            n += 1;
          }
        }
      }
      return n;
    },

    findPendingByConversation(conversationId) {
      const now = new Date();
      const out: PendingTimesheetChange[] = [];
      for (const c of byId.values()) {
        const cur = refreshExpiry(c, now);
        if (
          cur.conversationId === conversationId &&
          cur.status === 'pending' &&
          !isExpired(cur, now)
        ) {
          out.push(cloneChange(cur));
        }
      }
      return out;
    },
  };
}

let defaultStore: PendingTimesheetChangeStore | null = null;

export function getDefaultPendingTimesheetChangeStore(): PendingTimesheetChangeStore {
  if (!defaultStore) {
    defaultStore = createPendingTimesheetChangeStore();
  }
  return defaultStore;
}

export function resetDefaultPendingTimesheetChangeStore(): void {
  defaultStore = null;
}

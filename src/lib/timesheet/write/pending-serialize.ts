import {
  COMPLETED_RETENTION_SECONDS,
  PENDING_CHANGE_TTL_MS,
  PENDING_CHANGE_TTL_SECONDS,
  type PendingTimesheetChange,
} from '@/lib/timesheet/write/pending-types';
import {
  PendingStoreError,
  type CreatePendingInput,
  type PendingTimesheetChangeStore,
} from '@/lib/timesheet/write/pending-store-types';

export type SerializedPendingChange = Omit<
  PendingTimesheetChange,
  'createdAt' | 'expiresAt' | 'claimedAt' | 'completedAt'
> & {
  createdAt: string;
  expiresAt: string;
  claimedAt?: string;
  completedAt?: string;
};

export function serializePending(
  change: PendingTimesheetChange
): SerializedPendingChange {
  return {
    ...change,
    createdAt: change.createdAt.toISOString(),
    expiresAt: change.expiresAt.toISOString(),
    claimedAt: change.claimedAt?.toISOString(),
    completedAt: change.completedAt?.toISOString(),
    originalSnapshot: {
      date: change.originalSnapshot.date,
      entries: change.originalSnapshot.entries.map((e) => ({ ...e })),
    },
    proposedSnapshot: {
      date: change.proposedSnapshot.date,
      entries: change.proposedSnapshot.entries.map((e) => ({ ...e })),
    },
    summaryPayload: { ...change.summaryPayload },
    writeEntries: change.writeEntries.map((e) => ({ ...e })),
    completedResult: change.completedResult
      ? ({ ...change.completedResult } as PendingTimesheetChange['completedResult'])
      : undefined,
  };
}

export function deserializePending(
  raw: SerializedPendingChange
): PendingTimesheetChange {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    expiresAt: new Date(raw.expiresAt),
    claimedAt: raw.claimedAt ? new Date(raw.claimedAt) : undefined,
    completedAt: raw.completedAt ? new Date(raw.completedAt) : undefined,
    originalSnapshot: {
      date: raw.originalSnapshot.date,
      entries: raw.originalSnapshot.entries.map((e) => ({ ...e })),
    },
    proposedSnapshot: {
      date: raw.proposedSnapshot.date,
      entries: raw.proposedSnapshot.entries.map((e) => ({ ...e })),
    },
    summaryPayload: { ...raw.summaryPayload },
    writeEntries: raw.writeEntries.map((e) => ({ ...e })),
  };
}

export function clonePending(
  change: PendingTimesheetChange
): PendingTimesheetChange {
  return deserializePending(serializePending(change));
}

export function buildPendingFromCreateInput(
  input: CreatePendingInput,
  now = new Date()
): PendingTimesheetChange {
  const ttl = input.ttlMs ?? PENDING_CHANGE_TTL_MS;
  return {
    ...input,
    status: input.status ?? 'pending',
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttl),
  };
}

export {
  PENDING_CHANGE_TTL_MS,
  PENDING_CHANGE_TTL_SECONDS,
  COMPLETED_RETENTION_SECONDS,
  PendingStoreError,
};
export type { CreatePendingInput, PendingTimesheetChangeStore };

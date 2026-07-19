/**
 * Pending Timesheet Change store — production default is Redis.
 * In-memory implementation is exported only for explicit test injection.
 */

import { createRedisPendingTimesheetChangeStore } from '@/lib/timesheet/write/pending-store-redis';
import {
  createInMemoryPendingTimesheetChangeStore,
  createPendingTimesheetChangeStore,
} from '@/lib/timesheet/write/pending-store-memory';
import type { PendingTimesheetChangeStore } from '@/lib/timesheet/write/pending-store-types';

export type { PendingTimesheetChangeStore, CreatePendingInput, FenceTransitionResult } from '@/lib/timesheet/write/pending-store-types';
export { PendingStoreError } from '@/lib/timesheet/write/pending-store-types';
export {
  createInMemoryPendingTimesheetChangeStore,
  createPendingTimesheetChangeStore,
};
export {
  createRedisPendingTimesheetChangeStore,
  PENDING_CHANGE_KEY_PREFIX,
  PENDING_CONV_KEY_PREFIX,
  pendingChangeKey,
  pendingConversationKey,
} from '@/lib/timesheet/write/pending-store-redis';

let defaultStore: PendingTimesheetChangeStore | null = null;

/**
 * Production default: Redis-backed shared store.
 * Does NOT fall back to in-memory if Redis is missing — callers fail closed.
 */
export function getDefaultPendingTimesheetChangeStore(): PendingTimesheetChangeStore {
  if (!defaultStore) {
    defaultStore = createRedisPendingTimesheetChangeStore();
  }
  return defaultStore;
}

/** Test helper: replace or clear the process default. */
export function setDefaultPendingTimesheetChangeStore(
  store: PendingTimesheetChangeStore | null
): void {
  defaultStore = store;
}

export function resetDefaultPendingTimesheetChangeStore(): void {
  defaultStore = null;
}

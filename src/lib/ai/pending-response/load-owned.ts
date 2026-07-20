/**
 * Load owned pending Timesheet changes for semantic pending-response routing.
 * Never silently picks among multiple owned proposals.
 */

import { getConversationContext } from '@/lib/conversation/context';
import { buildSafePendingProposalContext } from '@/lib/ai/pending-response/safe-proposal';
import type { OwnedPendingRef } from '@/lib/ai/pending-response/enforce';
import {
  getDefaultPendingTimesheetChangeStore,
  PendingStoreError,
  type PendingTimesheetChangeStore,
} from '@/lib/timesheet/write/pending-store';
import type { PendingTimesheetChange } from '@/lib/timesheet/write/pending-types';

export type LoadOwnedPendingResult =
  | { status: 'none' }
  | { status: 'owned'; pending: OwnedPendingRef; employeeId: string }
  | {
      status: 'multiple_owned';
      pending: OwnedPendingRef[];
      employeeId: string;
    }
  | { status: 'store_unavailable' }
  | { status: 'context_unavailable'; message: string };

export type LoadOwnedPendingInput = {
  conversationId: string;
  slackUserId: string;
  requestId?: string;
  pendingStore?: PendingTimesheetChangeStore;
  /** Injected context loader for tests */
  getContext?: typeof getConversationContext;
  /** Injectable clock for expiry tests */
  nowMs?: number;
};

function toOwnedRef(change: PendingTimesheetChange): OwnedPendingRef {
  return {
    confirmationId: change.confirmationId,
    operation: change.operation,
    date: change.date,
    summaryPayload: change.summaryPayload,
    proposal: buildSafePendingProposalContext(change),
  };
}

function isConfirmableOwned(
  change: PendingTimesheetChange,
  slackUserId: string,
  employeeId: string,
  nowMs: number
): boolean {
  if (change.status !== 'pending') return false;
  if (change.slackUserId !== slackUserId) return false;
  if (change.employeeId !== employeeId) return false;
  const expiresAt = new Date(change.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return false;
  return true;
}

/**
 * Resolve Conversation Context, then load confirmable pending change(s) owned by
 * slackUserId + conversationId + context employeeId.
 * Returns `multiple_owned` when more than one confirmable proposal exists —
 * callers must not pick by createdAt or array order.
 */
export async function loadOwnedPendingChange(
  input: LoadOwnedPendingInput
): Promise<LoadOwnedPendingResult> {
  const conversationId = input.conversationId?.trim();
  const slackUserId = input.slackUserId?.trim();
  if (!conversationId || !slackUserId) {
    return { status: 'none' };
  }

  const store = input.pendingStore ?? getDefaultPendingTimesheetChangeStore();
  const nowMs = input.nowMs ?? Date.now();

  let convEmployeeId: string;
  try {
    const getCtx = input.getContext ?? getConversationContext;
    const conv = await getCtx({
      conversationId,
      slackUserId,
      requestId: input.requestId,
      ensureWorkContext: false,
    });
    convEmployeeId = conv.employeeId;
  } catch (error) {
    // Context unavailable: only fail closed if a confirmable pending exists for this user.
    try {
      const list = await store.findPendingByConversation(conversationId);
      const confirmableForUser = list.filter(
        (c) =>
          c.status === 'pending' &&
          c.slackUserId === slackUserId &&
          new Date(c.expiresAt).getTime() > nowMs
      );
      if (confirmableForUser.length === 0) {
        return { status: 'none' };
      }
    } catch (storeError) {
      if (
        storeError instanceof PendingStoreError &&
        storeError.code === 'REDIS_UNAVAILABLE'
      ) {
        return { status: 'store_unavailable' };
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'context_unavailable', message };
  }

  try {
    const list = await store.findPendingByConversation(conversationId);
    const owned = list.filter((c) =>
      isConfirmableOwned(c, slackUserId, convEmployeeId, nowMs)
    );

    if (owned.length === 0) {
      return { status: 'none' };
    }

    if (owned.length === 1) {
      return {
        status: 'owned',
        employeeId: convEmployeeId,
        pending: toOwnedRef(owned[0]!),
      };
    }

    return {
      status: 'multiple_owned',
      employeeId: convEmployeeId,
      pending: owned.map(toOwnedRef),
    };
  } catch (error) {
    if (
      error instanceof PendingStoreError &&
      error.code === 'REDIS_UNAVAILABLE'
    ) {
      return { status: 'store_unavailable' };
    }
    throw error;
  }
}

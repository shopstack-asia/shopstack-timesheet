/**
 * Load owned pending Timesheet change for semantic pending-response routing.
 */

import { getConversationContext } from '@/lib/conversation/context';
import { buildSafePendingProposalContext } from '@/lib/ai/pending-response/safe-proposal';
import type { OwnedPendingRef } from '@/lib/ai/pending-response/enforce';
import {
  getDefaultPendingTimesheetChangeStore,
  PendingStoreError,
  type PendingTimesheetChangeStore,
} from '@/lib/timesheet/write/pending-store';

export type LoadOwnedPendingResult =
  | { status: 'none' }
  | { status: 'owned'; pending: OwnedPendingRef; employeeId: string }
  | { status: 'store_unavailable' }
  | { status: 'context_unavailable'; message: string };

export type LoadOwnedPendingInput = {
  conversationId: string;
  slackUserId: string;
  requestId?: string;
  pendingStore?: PendingTimesheetChangeStore;
  /** Injected context loader for tests */
  getContext?: typeof getConversationContext;
};

/**
 * Resolve Conversation Context, then load a pending change owned by
 * slackUserId + conversationId + context employeeId with status=pending.
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
    // Context unavailable: only fail closed if a pending row exists for this user.
    // Otherwise continue the normal AI-first path (no owned pending to authorize).
    try {
      const list = await store.findPendingByConversation(conversationId);
      const forUser = list.filter(
        (c) => c.status === 'pending' && c.slackUserId === slackUserId
      );
      if (forUser.length === 0) {
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
    const owned = list.filter(
      (c) =>
        c.status === 'pending' &&
        c.slackUserId === slackUserId &&
        c.employeeId === convEmployeeId
    );

    if (owned.length === 0) {
      return { status: 'none' };
    }

    const selected = [...owned].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0]!;

    return {
      status: 'owned',
      employeeId: convEmployeeId,
      pending: {
        confirmationId: selected.confirmationId,
        operation: selected.operation,
        date: selected.date,
        summaryPayload: selected.summaryPayload,
        proposal: buildSafePendingProposalContext(selected),
      },
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

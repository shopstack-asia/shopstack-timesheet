import { auditTimesheetWrite } from '@/lib/timesheet/write/audit-log';
import {
  getDefaultPendingTimesheetChangeStore,
  PendingStoreError,
  type PendingTimesheetChangeStore,
} from '@/lib/timesheet/write/pending-store';
import {
  STORE_UNAVAILABLE_SAFE_MESSAGE,
  type CancelTimesheetChangeResult,
} from '@/lib/timesheet/write/pending-types';
import type { WriteIdentity } from '@/lib/timesheet/write/prepare';

export type CancelDeps = {
  pendingStore?: PendingTimesheetChangeStore;
};

/**
 * Cancel a pending Timesheet change. No Google Sheets mutation.
 */
export async function cancelTimesheetChange(
  identity: WriteIdentity,
  confirmationId: string | undefined,
  deps?: CancelDeps
): Promise<CancelTimesheetChangeResult> {
  const store = deps?.pendingStore ?? getDefaultPendingTimesheetChangeStore();
  const cancelledMsg =
    'ยกเลิกรายการแล้วครับ ยังไม่มีการเปลี่ยนแปลงข้อมูล Timesheet';

  try {
    let id = confirmationId?.trim() || '';

    if (!id) {
      const pending = (await store.findPendingByConversation(identity.conversationId))
      .filter(
        (c) =>
          c.slackUserId === identity.slackUserId &&
          c.employeeId === identity.employeeId
      );
      if (pending.length === 0) {
      return {
        status: 'no_pending_change',
        message: 'ตอนนี้ไม่มีรายการ Timesheet ที่รอการยืนยันครับ',
      };
    }
      if (pending.length > 1) {
      return {
        status: 'no_pending_change',
        message:
          'มีหลายรายการที่รอการยืนยัน กรุณาระบุว่ารายการใดต้องการยกเลิกครับ',
      };
    }
      id = pending[0]!.confirmationId;
    }

    const existing = await store.get(id);
    if (!existing) {
    return {
      status: 'no_pending_change',
      message: 'ตอนนี้ไม่มีรายการ Timesheet ที่รอการยืนยันครับ',
    };
    }

    if (
    existing.slackUserId !== identity.slackUserId ||
    existing.conversationId !== identity.conversationId ||
    existing.employeeId !== identity.employeeId
    ) {
    return {
      status: 'no_pending_change',
      message: 'ไม่สามารถยกเลิกรายการนี้ได้ครับ',
    };
    }

    if (existing.status === 'completed') {
    return {
      status: 'already_completed',
      message: 'รายการนี้ถูกดำเนินการเรียบร้อยแล้วครับ',
    };
    }

    if (
    existing.status === 'expired' ||
    existing.expiresAt.getTime() <= Date.now()
    ) {
    return {
      status: 'expired',
      message: 'รายการยืนยันหมดอายุแล้วครับ',
    };
    }

    if (existing.status === 'cancelled') {
    return {
      status: 'cancelled',
      confirmationId: id,
      message: cancelledMsg,
    };
    }

    if (existing.status !== 'pending') {
    return {
      status: 'no_pending_change',
      message: 'ไม่สามารถยกเลิกรายการนี้ได้ในขณะนี้ครับ',
    };
    }

    await store.markCancelled(id);
    auditTimesheetWrite({
    message: 'cancel_pending',
    confirmationId: id,
    conversationId: identity.conversationId,
    operation: existing.operation,
    pendingStatus: 'cancelled',
    executionStatus: 'cancelled',
    });

    return {
      status: 'cancelled',
      confirmationId: id,
      message: cancelledMsg,
    };
  } catch (error) {
    if (error instanceof PendingStoreError && error.code === 'REDIS_UNAVAILABLE') {
      return { status: 'unavailable', message: STORE_UNAVAILABLE_SAFE_MESSAGE };
    }
    throw error;
  }
}

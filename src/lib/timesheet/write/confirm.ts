import {
  agentAuthFromConversationIdentity,
  readDailyTimesheetForEmployee,
} from '@/lib/timesheet/canonical-read';
import { submitDayTimesheetForStaff } from '@/lib/timesheet/timesheet-service';
import { SubmitPolicyError } from '@/lib/timesheet/submit-policy';
import { SheetsWriteLockError } from '@/lib/sheets-write-lock';
import { auditTimesheetWrite } from '@/lib/timesheet/write/audit-log';
import {
  getDefaultPendingTimesheetChangeStore,
  type PendingTimesheetChangeStore,
} from '@/lib/timesheet/write/pending-store';
import {
  buildDaySnapshot,
  hashDaySnapshot,
  snapshotsEqual,
  snapshotsContentEqual,
} from '@/lib/timesheet/write/snapshot-hash';
import { PendingStoreError } from '@/lib/timesheet/write/pending-store';
import type {
  ConfirmTimesheetChangeResult,
  PendingTimesheetChange,
} from '@/lib/timesheet/write/pending-types';
import {
  COMPLETED_RETENTION_SECONDS,
  EXECUTING_LEASE_MS,
  INCOMPLETE_DAY_SAFE_MESSAGE,
  STORE_UNAVAILABLE_SAFE_MESSAGE,
} from '@/lib/timesheet/write/pending-types';
import type { WriteIdentity } from '@/lib/timesheet/write/prepare';

export type ConfirmDeps = {
  pendingStore?: PendingTimesheetChangeStore;
  readDaily?: typeof readDailyTimesheetForEmployee;
  submitDay?: typeof submitDayTimesheetForStaff;
};

function ownershipOk(
  pending: PendingTimesheetChange,
  identity: WriteIdentity
): boolean {
  return (
    pending.slackUserId === identity.slackUserId &&
    pending.conversationId === identity.conversationId &&
    pending.employeeId === identity.employeeId
  );
}

function successMessage(
  pending: PendingTimesheetChange,
  totalHours: number,
  verified: {
    entries: Array<{
      clientName?: string;
      projectName?: string;
      taskName?: string;
      hours: number;
    }>;
    totalHours: number;
  }
): string {
  const date = pending.date || pending.proposedSnapshot.date;
  if (pending.operation === 'create_entry') {
    const s = pending.summaryPayload;
    return [
      'บันทึก Timesheet เรียบร้อยแล้วครับ',
      '',
      `• *${String(s.clientName || '')}* — ${String(s.projectName || '')}: ${String(s.taskName || '')} ${String(s.hours ?? '')} ชั่วโมง`,
      `• วันที่ ${date}`,
      '',
      `รวมเวลาวันนี้ *${totalHours} ชั่วโมง*`,
    ].join('\n');
  }
  if (pending.operation === 'update_entry') {
    const s = pending.summaryPayload;
    return [
      'แก้ไข Timesheet เรียบร้อยแล้วครับ',
      '',
      `• ${String(s.clientName || '')} — ${String(s.taskName || '')} จาก ${String(s.fromHours ?? '')} เป็น *${String(s.toHours ?? '')} ชั่วโมง*`,
      `• รวมทั้งวัน *${totalHours} ชั่วโมง*`,
    ].join('\n');
  }
  if (pending.operation === 'delete_entry') {
    const s = pending.summaryPayload;
    const line = verified.entries
      .map(
        (e) =>
          `• ${e.clientName || ''} — ${e.projectName || ''}: ${e.taskName || ''} ${e.hours} ชั่วโมง`
      )
      .join('\n');
    return [
      'ลบรายการ Timesheet เรียบร้อยแล้วครับ',
      '',
      `• ${String(s.clientName || '')} — ${String(s.projectName || '')}: ${String(s.taskName || '')} ${String(s.hours ?? '')} ชั่วโมง`,
      '',
      line
        ? `ตอนนี้เหลือ:\n${line}\n\nรวม *${totalHours} ชั่วโมง*`
        : `ตอนนี้เหลือรวม *${totalHours} ชั่วโมง*`,
    ].join('\n');
  }
  return `บันทึก Timesheet เรียบร้อยแล้วครับ รวม *${totalHours} ชั่วโมง*`;
}

/**
 * Confirm and execute a pending Timesheet change.
 * Mutation data comes only from the server-side pending store.
 */
export async function confirmTimesheetChange(
  identity: WriteIdentity,
  confirmationId: string,
  deps?: ConfirmDeps
): Promise<ConfirmTimesheetChangeResult> {
  const store = deps?.pendingStore ?? getDefaultPendingTimesheetChangeStore();
  const read = deps?.readDaily ?? readDailyTimesheetForEmployee;
  const submit = deps?.submitDay ?? submitDayTimesheetForStaff;
  const started = Date.now();
  const id = confirmationId?.trim() || '';

  if (!id) {
    return {
      status: 'failed',
      message: 'ไม่พบรหัสยืนยัน กรุณาเตรียมรายการใหม่ครับ',
    };
  }

  try {
    let existing = await store.get(id);
    if (!existing) {
      return { status: 'failed', message: 'ไม่พบรายการยืนยัน กรุณาเตรียมรายการใหม่ครับ' };
    }
    if (!ownershipOk(existing, identity)) {
      auditTimesheetWrite({ message: 'confirm_rejected_ownership', confirmationId: id, conversationId: identity.conversationId, executionStatus: 'rejected' });
      return { status: 'failed', message: 'ไม่สามารถยืนยันรายการนี้ได้ครับ' };
    }
    if (existing.status === 'completed') {
      return existing.completedResult?.status === 'completed'
        ? existing.completedResult
        : { status: 'already_completed', message: 'รายการนี้ถูกดำเนินการเรียบร้อยแล้วครับ' };
    }
    if (existing.status === 'cancelled') return { status: 'cancelled', message: 'รายการนี้ถูกยกเลิกแล้วครับ' };
    if (existing.status === 'expired' || existing.expiresAt.getTime() <= Date.now()) {
      return { status: 'expired', message: 'รายการยืนยันหมดอายุแล้ว กรุณาสั่งรายการใหม่ครับ' };
    }
    if (existing.status === 'conflict') return { status: 'conflict', message: 'Timesheet มีการเปลี่ยนแปลงหลังจากขอการยืนยัน กรุณาตรวจสอบข้อมูลล่าสุดแล้วลองใหม่ครับ' };
    if (existing.status === 'failed') return { status: 'failed', message: existing.safeError || 'ยังไม่สามารถบันทึก Timesheet ได้ เนื่องจากการเชื่อมต่อกับแหล่งข้อมูลมีปัญหาครับ ข้อมูลเดิมยังไม่ถูกเปลี่ยนแปลง' };

    let claimed: PendingTimesheetChange | null;
    let recoveredStaleExecution = false;
    if (existing.status === 'executing') {
      if (!existing.claimedAt || Date.now() - existing.claimedAt.getTime() < EXECUTING_LEASE_MS) {
        return { status: 'already_processing', message: 'รายการกำลังดำเนินการอยู่ กรุณารอสักครู่ครับ' };
      }
      claimed = await store.reclaimStaleExecution(id, EXECUTING_LEASE_MS);
      if (!claimed) {
        return { status: 'already_processing', message: 'รายการกำลังดำเนินการอยู่ กรุณารอสักครู่ครับ' };
      }
      recoveredStaleExecution = true;
    } else {
      claimed = await store.claimForExecution(id);
      if (!claimed) {
        existing = await store.get(id);
        if (existing?.status === 'completed' && existing.completedResult?.status === 'completed') return existing.completedResult;
        if (existing?.status === 'executing') return { status: 'already_processing', message: 'รายการกำลังดำเนินการอยู่ กรุณารอสักครู่ครับ' };
        if (existing?.status === 'expired') return { status: 'expired', message: 'รายการยืนยันหมดอายุแล้ว กรุณาสั่งรายการใหม่ครับ' };
        return { status: 'failed', message: 'ไม่สามารถยืนยันรายการนี้ได้ในขณะนี้ครับ' };
      }
    }

    const date = claimed.date || claimed.proposedSnapshot.date;
    const currentDay = await read({ employeeId: identity.employeeId, email: identity.email, slackUserId: identity.slackUserId }, date);
    const currentResult = buildDaySnapshot(date, currentDay.entries);
    if (!currentResult.ok) {
      await store.markFailed(id, INCOMPLETE_DAY_SAFE_MESSAGE);
      auditTimesheetWrite({ message: 'confirm_incomplete_day', confirmationId: id, conversationId: identity.conversationId, operation: claimed.operation, targetDate: date, safeErrorCode: currentResult.reason, invalidEntryCount: currentResult.invalidEntryIndexes.length });
      return { status: 'failed', message: INCOMPLETE_DAY_SAFE_MESSAGE };
    }
    const currentSnapshot = currentResult.snapshot;
    const complete = async (
      snapshot: typeof currentSnapshot,
      day: typeof currentDay
    ): Promise<ConfirmTimesheetChangeResult> => {
      const verified = {
        entries: day.entries.map((e) => ({ clientName: e.clientName, projectName: e.projectName, taskName: e.taskName, hours: e.hours })),
        totalHours: day.totalHours,
      };
      const completed: ConfirmTimesheetChangeResult = { status: 'completed', operation: claimed.operation, date, verified, message: successMessage(claimed, day.totalHours, verified) };
      await store.markCompleted(id, { resultSnapshotHash: hashDaySnapshot(snapshot), completedResult: completed, retentionSeconds: COMPLETED_RETENTION_SECONDS });
      return completed;
    };

    if (snapshotsContentEqual(currentSnapshot, claimed.proposedSnapshot)) {
      return complete(currentSnapshot, currentDay);
    }
    const equalsOriginal = recoveredStaleExecution
      ? snapshotsEqual(currentSnapshot, claimed.originalSnapshot) ||
        snapshotsContentEqual(currentSnapshot, claimed.originalSnapshot)
      : hashDaySnapshot(currentSnapshot) === claimed.originalSnapshotHash;
    if (!equalsOriginal) {
      await store.markConflict(id);
      auditTimesheetWrite({ message: 'confirm_conflict', confirmationId: id, conversationId: identity.conversationId, operation: claimed.operation, targetDate: date, executionStatus: 'conflict', durationMs: Date.now() - started });
      return { status: 'conflict', message: 'Timesheet มีการเปลี่ยนแปลงหลังจากขอการยืนยัน กรุณาตรวจสอบข้อมูลล่าสุดแล้วลองใหม่ครับ' };
    }

    try {
      const auth = agentAuthFromConversationIdentity({ employeeId: identity.employeeId, email: identity.email, slackUserId: identity.slackUserId });
      await submit(auth, date, claimed.writeEntries, { allowCustomProject: false });
      const verifiedDay = await read({ employeeId: identity.employeeId, email: identity.email, slackUserId: identity.slackUserId }, date);
      const verifiedResult = buildDaySnapshot(date, verifiedDay.entries);
      if (!verifiedResult.ok) {
        await store.markFailed(id, INCOMPLETE_DAY_SAFE_MESSAGE);
        auditTimesheetWrite({ message: 'confirm_verify_incomplete_day', confirmationId: id, conversationId: identity.conversationId, operation: claimed.operation, targetDate: date, safeErrorCode: verifiedResult.reason, invalidEntryCount: verifiedResult.invalidEntryIndexes.length });
        return { status: 'failed', message: INCOMPLETE_DAY_SAFE_MESSAGE };
      }
      if (!snapshotsContentEqual(verifiedResult.snapshot, claimed.proposedSnapshot)) {
        const safe = 'ยังไม่สามารถยืนยันผลบันทึก Timesheet ได้ กรุณาตรวจสอบข้อมูลล่าสุดแล้วลองใหม่ครับ';
        await store.markFailed(id, safe);
        return { status: 'failed', message: safe };
      }
      return complete(verifiedResult.snapshot, verifiedDay);
    } catch (error) {
      if (error instanceof PendingStoreError && error.code === 'REDIS_UNAVAILABLE') throw error;
      const message = error instanceof SubmitPolicyError
        ? error.message
        : error instanceof SheetsWriteLockError
          ? 'ระบบกำลังบันทึก Timesheet จากคำขออื่นอยู่ กรุณาลองใหม่อีกครั้งครับ ข้อมูลเดิมยังไม่ถูกเปลี่ยนแปลง'
          : 'ยังไม่สามารถบันทึก Timesheet ได้ เนื่องจากการเชื่อมต่อกับแหล่งข้อมูลมีปัญหาครับ ข้อมูลเดิมยังไม่ถูกเปลี่ยนแปลง';
      await store.markFailed(id, message);
      return { status: 'failed', message };
    }
  } catch (error) {
    if (error instanceof PendingStoreError && error.code === 'REDIS_UNAVAILABLE') {
      return { status: 'unavailable', message: STORE_UNAVAILABLE_SAFE_MESSAGE };
    }
    throw error;
  }
}

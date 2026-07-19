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
  daySnapshotFromDailyEntries,
  hashDaySnapshot,
  snapshotsEqual,
} from '@/lib/timesheet/write/snapshot-hash';
import type {
  ConfirmTimesheetChangeResult,
  PendingTimesheetChange,
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

  const existing = store.get(id);
  if (!existing) {
    return {
      status: 'failed',
      message: 'ไม่พบรายการยืนยัน กรุณาเตรียมรายการใหม่ครับ',
    };
  }

  if (!ownershipOk(existing, identity)) {
    auditTimesheetWrite({
      message: 'confirm_rejected_ownership',
      confirmationId: id,
      conversationId: identity.conversationId,
      executionStatus: 'rejected',
    });
    return {
      status: 'failed',
      message: 'ไม่สามารถยืนยันรายการนี้ได้ครับ',
    };
  }

  if (existing.status === 'completed') {
    if (
      existing.completedResult &&
      existing.completedResult.status === 'completed'
    ) {
      return existing.completedResult;
    }
    return {
      status: 'already_completed',
      message: 'รายการนี้ถูกดำเนินการเรียบร้อยแล้วครับ',
    };
  }

  if (existing.status === 'cancelled') {
    return {
      status: 'cancelled',
      message: 'รายการนี้ถูกยกเลิกแล้วครับ',
    };
  }

  if (existing.status === 'expired' || existing.expiresAt.getTime() <= Date.now()) {
    return {
      status: 'expired',
      message: 'รายการยืนยันหมดอายุแล้ว กรุณาสั่งรายการใหม่ครับ',
    };
  }

  if (existing.status === 'conflict') {
    return {
      status: 'conflict',
      message:
        'Timesheet มีการเปลี่ยนแปลงหลังจากขอการยืนยัน กรุณาตรวจสอบข้อมูลล่าสุดแล้วลองใหม่ครับ',
    };
  }

  if (existing.status === 'failed') {
    return {
      status: 'failed',
      message:
        existing.safeError ||
        'ยังไม่สามารถบันทึก Timesheet ได้ เนื่องจากการเชื่อมต่อกับแหล่งข้อมูลมีปัญหาครับ ข้อมูลเดิมยังไม่ถูกเปลี่ยนแปลง',
    };
  }

  if (existing.status === 'executing') {
    // Another claim in progress — do not double-write
    return {
      status: 'failed',
      message: 'รายการกำลังดำเนินการอยู่ กรุณารอสักครู่ครับ',
    };
  }

  const claimed = store.claimForExecution(id);
  if (!claimed) {
    const again = store.get(id);
    if (again?.status === 'completed' && again.completedResult?.status === 'completed') {
      return again.completedResult;
    }
    if (again?.status === 'expired') {
      return {
        status: 'expired',
        message: 'รายการยืนยันหมดอายุแล้ว กรุณาสั่งรายการใหม่ครับ',
      };
    }
    return {
      status: 'failed',
      message: 'ไม่สามารถยืนยันรายการนี้ได้ในขณะนี้ครับ',
    };
  }

  const date = claimed.date || claimed.proposedSnapshot.date;
  const beforeCount = claimed.originalSnapshot.entries.length;
  const afterCount = claimed.proposedSnapshot.entries.length;
  const hoursBefore = claimed.originalSnapshot.entries.reduce(
    (s, e) => s + e.hours,
    0
  );

  try {
    const currentDay = await read(
      {
        employeeId: identity.employeeId,
        email: identity.email,
        slackUserId: identity.slackUserId,
      },
      date
    );
    const currentSnapshot = daySnapshotFromDailyEntries(date, currentDay.entries);
    const currentHash = hashDaySnapshot(currentSnapshot);

    if (currentHash !== claimed.originalSnapshotHash) {
      store.markConflict(id);
      auditTimesheetWrite({
        message: 'confirm_conflict',
        confirmationId: id,
        conversationId: identity.conversationId,
        operation: claimed.operation,
        targetDate: date,
        executionStatus: 'conflict',
        entryCountBefore: beforeCount,
        durationMs: Date.now() - started,
      });
      return {
        status: 'conflict',
        message:
          'Timesheet มีการเปลี่ยนแปลงหลังจากขอการยืนยัน กรุณาตรวจสอบข้อมูลล่าสุดแล้วลองใหม่ครับ',
      };
    }

    const auth = agentAuthFromConversationIdentity({
      employeeId: identity.employeeId,
      email: identity.email,
      slackUserId: identity.slackUserId,
    });

    await submit(auth, date, claimed.writeEntries, {
      allowCustomProject: false,
    });

    const verifiedDay = await read(
      {
        employeeId: identity.employeeId,
        email: identity.email,
        slackUserId: identity.slackUserId,
      },
      date
    );
    const verifiedSnapshot = daySnapshotFromDailyEntries(
      date,
      verifiedDay.entries
    );

    // Compare by projectId+taskId+hours (ids may be assigned on create)
    const proposedWithoutIds = {
      date,
      entries: claimed.proposedSnapshot.entries.map((e) => ({
        projectId: e.projectId,
        taskId: e.taskId,
        hours: e.hours,
      })),
    };
    const verifiedComparable = {
      date,
      entries: verifiedSnapshot.entries.map((e) => ({
        projectId: e.projectId,
        taskId: e.taskId,
        hours: e.hours,
      })),
    };

    if (!snapshotsEqual(proposedWithoutIds, verifiedComparable)) {
      const safe =
        'ยังไม่สามารถยืนยันผลบันทึก Timesheet ได้ กรุณาตรวจสอบข้อมูลล่าสุดแล้วลองใหม่ครับ';
      store.markFailed(id, safe);
      auditTimesheetWrite({
        message: 'confirm_verify_failed',
        confirmationId: id,
        conversationId: identity.conversationId,
        operation: claimed.operation,
        targetDate: date,
        executionStatus: 'failed',
        safeErrorCode: 'readback_mismatch',
        durationMs: Date.now() - started,
      });
      return { status: 'failed', message: safe };
    }

    const verified = {
      entries: verifiedDay.entries.map((e) => ({
        clientName: e.clientName,
        projectName: e.projectName,
        taskName: e.taskName,
        hours: e.hours,
      })),
      totalHours: verifiedDay.totalHours,
    };

    const completed: ConfirmTimesheetChangeResult = {
      status: 'completed',
      operation: claimed.operation,
      date,
      verified,
      message: successMessage(claimed, verifiedDay.totalHours, verified),
    };

    store.markCompleted(id, {
      resultSnapshotHash: hashDaySnapshot(verifiedSnapshot),
      completedResult: completed,
    });

    auditTimesheetWrite({
      message: 'confirm_completed',
      requestId: identity.requestId,
      eventId: identity.sourceEventId,
      conversationId: identity.conversationId,
      operation: claimed.operation,
      confirmationId: id,
      targetDate: date,
      pendingStatus: 'completed',
      executionStatus: 'completed',
      entryCountBefore: beforeCount,
      entryCountAfter: afterCount,
      totalHoursBefore: hoursBefore,
      totalHoursAfter: verifiedDay.totalHours,
      durationMs: Date.now() - started,
    });

    return completed;
  } catch (error) {
    let message =
      'ยังไม่สามารถบันทึก Timesheet ได้ เนื่องจากการเชื่อมต่อกับแหล่งข้อมูลมีปัญหาครับ ข้อมูลเดิมยังไม่ถูกเปลี่ยนแปลง';
    let code = 'write_failed';

    if (error instanceof SubmitPolicyError) {
      message = error.message;
      code = error.policyCode || 'policy';
    } else if (error instanceof SheetsWriteLockError) {
      message =
        'ระบบกำลังบันทึก Timesheet จากคำขออื่นอยู่ กรุณาลองใหม่อีกครั้งครับ ข้อมูลเดิมยังไม่ถูกเปลี่ยนแปลง';
      code = 'write_lock';
    }

    store.markFailed(id, message);
    auditTimesheetWrite({
      message: 'confirm_failed',
      confirmationId: id,
      conversationId: identity.conversationId,
      operation: claimed.operation,
      targetDate: date,
      executionStatus: 'failed',
      safeErrorCode: code,
      durationMs: Date.now() - started,
    });
    return { status: 'failed', message };
  }
}

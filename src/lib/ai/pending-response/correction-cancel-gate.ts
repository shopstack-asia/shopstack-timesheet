/**
 * Authoritative cancel-result handling for correction supersede flow.
 * Replacement prepare is allowed only when cancel returns status === 'cancelled'.
 */

import type { CancelTimesheetChangeResult } from '@/lib/timesheet/write/pending-types';

export type CorrectionCancelGate =
  | { proceed: true }
  | { proceed: false; message: string; reason: string };

function looksThai(text: string): boolean {
  return /[\u0E00-\u0E7F]/.test(text);
}

function assertNever(value: never): never {
  throw new Error(
    `Unhandled cancel status in correction gate: ${JSON.stringify(value)}`
  );
}

/**
 * Exhaustive gate: only `cancelled` may proceed to replacement prepare.
 * All other lifecycle outcomes fail closed with zero prepare calls.
 */
export function gateCorrectionAfterCancel(
  cancelResult: CancelTimesheetChangeResult,
  userMessage: string
): CorrectionCancelGate {
  const th = looksThai(userMessage);

  switch (cancelResult.status) {
    case 'cancelled':
      return { proceed: true };

    case 'already_completed':
      return {
        proceed: false,
        reason: 'correction_cancel_already_completed',
        message: th
          ? 'รายการเดิมบันทึกเสร็จแล้วครับ จึงยังไม่ได้เตรียมรายการแก้ไขใหม่ กรุณาสั่งแก้ไขหรืออัปเดต Timesheet เป็นคำขอใหม่ครับ'
          : 'The previous proposal has already completed, so a replacement was not prepared. Please send a new update request.',
      };

    case 'no_pending_change':
      return {
        proceed: false,
        reason: 'correction_cancel_no_pending',
        message: th
          ? 'รายการที่รออยู่อาจถูกยืนยันหรือเปลี่ยนแปลงไปแล้วครับ ยังไม่ได้เตรียมรายการแทนที่ กรุณาตรวจสอบ Timesheet ก่อนสั่งใหม่อีกครั้ง'
          : 'The pending proposal may already have been confirmed or changed. A replacement was not prepared — please check Timesheet before requesting another change.',
      };

    case 'expired':
      return {
        proceed: false,
        reason: 'correction_cancel_expired',
        message: th
          ? 'รายการยืนยันเดิมหมดอายุแล้วครับ กรุณาส่งคำขอ Timesheet ให้ครบอีกครั้ง'
          : 'The previous confirmation expired. Please submit the complete Timesheet request again.',
      };

    case 'unavailable':
      return {
        proceed: false,
        reason: 'correction_cancel_unavailable',
        message: th
          ? 'ระบบยืนยัน Timesheet ใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งครับ ยังไม่มีการเปลี่ยนแปลงข้อมูล'
          : 'Timesheet confirmation is temporarily unavailable. Please try again — no data was changed.',
      };

    default:
      return assertNever(cancelResult);
  }
}

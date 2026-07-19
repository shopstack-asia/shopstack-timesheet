/**
 * Soft slot enrichment after AI has already classified a write intent.
 * Does not classify business intent — only fills null hints from the same message.
 */

import { parseHoursValue, resolveDateExpression } from '@/lib/ai/intent/date-resolve';
import type { StructuredIntent } from '@/lib/ai/intent/types';

const WRITE = new Set([
  'create_timesheet_entry',
  'update_timesheet_entry',
  'delete_timesheet_entry',
]);

/**
 * When the model classifies a write intent but omits an obvious slot present in
 * the same message (e.g. "เป็น PM"), fill that null hint only.
 */
export function enrichWriteIntentSlots(
  intent: StructuredIntent,
  userMessage: string,
  now: Date = new Date()
): StructuredIntent {
  if (!WRITE.has(intent.intent)) return intent;

  let dateExpression = intent.dateExpression ?? null;
  let projectHint = intent.projectHint ?? null;
  let taskHint = intent.taskHint ?? null;
  let hours = intent.hours ?? null;

  if (hours == null) {
    const parsed = parseHoursValue(undefined, userMessage);
    if (parsed !== undefined) hours = parsed;
  }

  if (!dateExpression?.trim()) {
    const fromMsg = resolveDateExpression(userMessage, now);
    if (fromMsg) {
      if (/\btoday\b|วันนี้/i.test(userMessage)) dateExpression = 'วันนี้';
      else if (/\byesterday\b|เมื่อวาน/i.test(userMessage)) {
        dateExpression = 'เมื่อวาน';
      } else if (/\btomorrow\b|พรุ่งนี้/i.test(userMessage)) {
        dateExpression = 'พรุ่งนี้';
      } else {
        dateExpression = fromMsg;
      }
    }
  }

  if (!taskHint?.trim()) {
    const asTask =
      userMessage.match(
        /(?:เป็น|ในฐานะ|as|under)\s+([A-Za-z0-9ก-๙][A-Za-z0-9ก-๙ ._/&-]{0,40})/i
      ) ||
      userMessage.match(
        /(?:งาน|task)\s+([A-Za-z0-9ก-๙][A-Za-z0-9ก-๙ ._/&-]{0,40})/i
      );
    if (asTask?.[1]) {
      const hint = asTask[1].trim().replace(/[.,!?]+$/u, '');
      if (hint && !/^(วันนี้|เมื่อวาน|พรุ่งนี้|today|yesterday)$/i.test(hint)) {
        taskHint = hint;
      }
    }
  }

  if (!projectHint?.trim()) {
    // Prefer explicit project phrases, then unique-looking codes (RMS, HERTZ…)
    const named =
      userMessage.match(
        /(?:โปรเจกต์|โปรเจค|project)\s+([A-Za-z0-9ก-๙][A-Za-z0-9ก-๙ ._/&-]{0,40})/i
      ) ||
      userMessage.match(
        /(?:ของ)\s+([A-Z]{2,}[A-Z0-9_-]*)/
      );
    if (named?.[1]) {
      projectHint = named[1].trim().replace(/[.,!?]+$/u, '');
    } else {
      const code = userMessage.match(/\b([A-Z]{2,12})\b/);
      if (code?.[1] && !/^(PM|QA|DEV|HR|IT|OK|ID)$/i.test(code[1])) {
        // PM is usually a task abbreviation — leave for taskHint path
        projectHint = code[1];
      } else if (code?.[1] && /^(RMS|HERTZ)$/i.test(code[1])) {
        projectHint = code[1];
      }
    }
  }

  // If both still empty and message is "RMS เป็น PM" style already handled above.
  // When projectHint captured PM incorrectly, leave as-is — resolver will clarify.

  return {
    ...intent,
    dateExpression,
    projectHint,
    taskHint,
    hours,
  };
}

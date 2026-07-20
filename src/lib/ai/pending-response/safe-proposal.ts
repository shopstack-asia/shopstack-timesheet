import type { PendingTimesheetChange } from '@/lib/timesheet/write/pending-types';
import type { SafePendingProposalContext } from '@/lib/ai/pending-response/types';

function asOptionalString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
}

function asOptionalNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

/**
 * Build model-safe proposal context from a pending change.
 * Strips identity, confirmation IDs, hashes, fencing, and Redis details.
 */
export function buildSafePendingProposalContext(
  pending: PendingTimesheetChange
): SafePendingProposalContext {
  const p = pending.summaryPayload || {};
  const summaryText = String(pending.summary || '')
    .replace(/confirm_[a-f0-9]+/gi, '')
    .replace(/\bS\d{3,}\b/g, '')
    .trim();

  return {
    operation: pending.operation,
    date:
      asOptionalString(p.date) ||
      pending.date ||
      asOptionalString(pending.proposedSnapshot?.date),
    projectName: asOptionalString(p.projectName),
    taskName: asOptionalString(p.taskName),
    hours: asOptionalNumber(p.hours) ?? asOptionalNumber(p.toHours),
    fromHours: asOptionalNumber(p.fromHours),
    toHours: asOptionalNumber(p.toHours),
    summaryText,
  };
}

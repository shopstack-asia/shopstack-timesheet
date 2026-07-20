/**
 * Interpret confirm/cancel Tool Router results for selected-pending lifecycle.
 * Selection clears only from authoritative business statuses — never from
 * outer `toolResult.success` alone.
 */

import type { ToolResult } from '@/lib/tools/types';

export type SelectionToolOutcome =
  | { action: 'clear'; reason: string }
  | { action: 'preserve'; reason: string }
  | { action: 'clear_stale'; reason: string };

const CONFIRM_CLEAR_COMPLETED = new Set(['completed']);
const CONFIRM_CLEAR_STALE = new Set([
  'already_completed',
  'expired',
  'cancelled',
  'conflict',
  'failed',
]);
const CONFIRM_PRESERVE = new Set(['already_processing', 'unavailable']);

const CANCEL_CLEAR = new Set(['cancelled']);
const CANCEL_CLEAR_STALE = new Set(['already_completed', 'expired']);
const CANCEL_PRESERVE = new Set(['no_pending_change', 'unavailable']);

function readBusinessStatus(toolResult: ToolResult): string | null {
  if (!toolResult.success) return null;
  const payload = toolResult.result;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const status = (payload as { status?: unknown }).status;
  return typeof status === 'string' && status.trim() ? status.trim() : null;
}

/**
 * Decide whether to clear / clear-stale / preserve selected-pending navigation
 * after a confirm or cancel tool execution.
 */
export function resolveSelectionAfterToolResult(input: {
  toolName: string;
  toolResult: ToolResult;
}): SelectionToolOutcome {
  const { toolName, toolResult } = input;

  if (
    toolName !== 'confirm_timesheet_change' &&
    toolName !== 'cancel_timesheet_change'
  ) {
    return { action: 'preserve', reason: 'irrelevant_tool' };
  }

  if (!toolResult.success) {
    return { action: 'preserve', reason: 'tool_router_failure' };
  }

  const status = readBusinessStatus(toolResult);
  if (!status) {
    return { action: 'preserve', reason: 'malformed_or_missing_business_status' };
  }

  if (toolName === 'confirm_timesheet_change') {
    if (CONFIRM_CLEAR_COMPLETED.has(status)) {
      return { action: 'clear', reason: `confirm_${status}` };
    }
    if (CONFIRM_CLEAR_STALE.has(status)) {
      return { action: 'clear_stale', reason: `confirm_${status}` };
    }
    if (CONFIRM_PRESERVE.has(status)) {
      return { action: 'preserve', reason: `confirm_${status}` };
    }
    return { action: 'preserve', reason: `confirm_unknown_status_${status}` };
  }

  // cancel_timesheet_change
  if (CANCEL_CLEAR.has(status)) {
    return { action: 'clear', reason: `cancel_${status}` };
  }
  if (CANCEL_CLEAR_STALE.has(status)) {
    return { action: 'clear_stale', reason: `cancel_${status}` };
  }
  if (CANCEL_PRESERVE.has(status)) {
    return { action: 'preserve', reason: `cancel_${status}` };
  }
  return { action: 'preserve', reason: `cancel_unknown_status_${status}` };
}

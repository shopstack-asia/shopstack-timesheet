import { BusinessApiError } from '@/lib/business/errors';
import type { BusinessApiClient } from '@/lib/business/client';
import { createBusinessApiClient } from '@/lib/business/client';
import type { ContextManager } from '@/lib/conversation/context/context-manager';
import {
  getConversationContext,
  getDefaultContextManager,
} from '@/lib/conversation/context/context-manager';
import { IdentityResolutionError } from '@/lib/conversation/context/identity-resolver';
import {
  CanonicalTimesheetReadError,
  type CanonicalReadOptions,
} from '@/lib/timesheet/canonical-read';
import { ToolError } from '@/lib/tools/errors';
import type { DailyTimesheet, TimesheetRange } from '@/lib/tools/business/types';
import type { JsonValue, ToolContext, ToolResult } from '@/lib/tools/types';

export type ConversationIdentity = {
  employeeId: string;
  email: string;
  slackUserId?: string;
};

export type ReadDailyTimesheetFn = (
  identity: ConversationIdentity,
  date: string,
  options?: CanonicalReadOptions
) => Promise<DailyTimesheet>;

export type ReadTimesheetRangeFn = (
  identity: ConversationIdentity,
  startDate: string,
  endDate: string,
  options?: CanonicalReadOptions
) => Promise<TimesheetRange>;

export type BusinessToolDeps = {
  /** Injected client for tests; defaults to createBusinessApiClient(). */
  client?: BusinessApiClient;
  /** Injected context manager for tests. */
  contextManager?: ContextManager;
  /** Injected canonical Timesheet read (Google Sheets Time Log). */
  readDailyTimesheet?: ReadDailyTimesheetFn;
  readTimesheetRange?: ReadTimesheetRangeFn;
};

export function resolveBusinessClient(
  deps?: BusinessToolDeps
): BusinessApiClient {
  return deps?.client ?? createBusinessApiClient();
}

export function resolveContextManager(
  deps?: BusinessToolDeps
): ContextManager {
  return deps?.contextManager ?? getDefaultContextManager();
}

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ToolError('Tool execution cancelled', 'cancelled');
  }
}

/**
 * Reject AI-supplied employee identity. Identity comes only from Conversation Context.
 */
export function rejectAiEmployeeId(input: Record<string, unknown>): void {
  rejectAiIdentityFields(input, ['employeeId', 'employee_id']);
}

/**
 * Reject any AI-supplied identity fields. Identity comes only from Conversation Context.
 */
export function rejectAiIdentityFields(
  input: Record<string, unknown>,
  keys: readonly string[] = [
    'employeeId',
    'employee_id',
    'email',
    'slackUserId',
    'slack_user_id',
    'zohoRecordId',
    'zoho_record_id',
  ]
): void {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw new ToolError(
        `${key} must not be provided by the AI; identity is resolved from Slack/Zoho via Conversation Context`,
        'validation_error'
      );
    }
  }
}

export function requireConversationIds(context: ToolContext): {
  conversationId: string;
  slackUserId: string;
} {
  const conversationId =
    context.conversationId?.trim() ||
    context.metadata?.conversationId?.trim() ||
    '';
  const slackUserId =
    context.userId?.trim() ||
    context.metadata?.slackUserId?.trim() ||
    '';
  if (!conversationId) {
    throw new ToolError(
      'Missing conversationId in tool context',
      'validation_error'
    );
  }
  if (!slackUserId) {
    throw new ToolError(
      'Missing slackUserId in tool context',
      'validation_error'
    );
  }
  return { conversationId, slackUserId };
}

export function toolSuccess(
  tool: string,
  started: number,
  result: JsonValue
): ToolResult {
  return {
    success: true,
    tool,
    durationMs: Date.now() - started,
    result,
  };
}

export function toolFailureFromError(
  tool: string,
  started: number,
  error: unknown
): ToolResult {
  if (error instanceof IdentityResolutionError) {
    return {
      success: false,
      tool,
      durationMs: Date.now() - started,
      errorCode: error.code,
      errorMessage: error.message,
    };
  }
  if (error instanceof BusinessApiError) {
    return {
      success: false,
      tool,
      durationMs: Date.now() - started,
      errorCode: error.code,
      errorMessage: error.message,
    };
  }
  if (error instanceof CanonicalTimesheetReadError) {
    return {
      success: false,
      tool,
      durationMs: Date.now() - started,
      errorCode: error.code,
      errorMessage: error.message,
    };
  }
  if (error instanceof ToolError) {
    return {
      success: false,
      tool,
      durationMs: Date.now() - started,
      errorCode: error.code,
      errorMessage: error.message,
    };
  }
  return {
    success: false,
    tool,
    durationMs: Date.now() - started,
    errorCode: 'unexpected',
    errorMessage:
      error instanceof Error ? error.message : 'Unexpected tool failure',
  };
}

export function requestMeta(
  context: ToolContext,
  employeeId?: string
): {
  requestId?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
} {
  return {
    requestId: context.requestId,
    signal: context.signal,
    headers: employeeId
      ? {
          'X-Employee-Id': employeeId,
        }
      : undefined,
  };
}

export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireString(
  obj: Record<string, unknown>,
  key: string,
  label: string
): string {
  const v = obj[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new ToolError(
      `Malformed response: missing ${label}`,
      'validation_error'
    );
  }
  return v.trim();
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

/** Re-export for tools that prefer the module-level helper. */
export { getConversationContext };

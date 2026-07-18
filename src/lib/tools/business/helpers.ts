import { BusinessApiError } from '@/lib/business/errors';
import type { BusinessApiClient } from '@/lib/business/client';
import { createBusinessApiClient } from '@/lib/business/client';
import { ToolError } from '@/lib/tools/errors';
import type { JsonValue, ToolContext, ToolResult } from '@/lib/tools/types';

export type BusinessToolDeps = {
  /** Injected client for tests; defaults to createBusinessApiClient(). */
  client?: BusinessApiClient;
};

export function resolveBusinessClient(
  deps?: BusinessToolDeps
): BusinessApiClient {
  return deps?.client ?? createBusinessApiClient();
}

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ToolError('Tool execution cancelled', 'cancelled');
  }
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
  if (error instanceof BusinessApiError) {
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

export function requestMeta(context: ToolContext): {
  requestId?: string;
  signal?: AbortSignal;
} {
  return {
    requestId: context.requestId,
    signal: context.signal,
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

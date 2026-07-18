import { ToolError } from '@/lib/tools/errors';
import type { Tool, ToolContext, ToolResult } from '@/lib/tools/types';

export type ToolExecutorOptions = {
  /** Per-call timeout (ms). Default 5000. */
  timeoutMs?: number;
  /** Transient execution retries. Default 0 (tools should be idempotent if >0). */
  maxRetries?: number;
};

function logTool(
  level: 'info' | 'error',
  message: string,
  fields: Record<string, string | number | boolean | undefined>
): void {
  const line = JSON.stringify({
    scope: 'tools',
    level,
    message,
    ...fields,
    ts: new Date().toISOString(),
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    throw new ToolError('Tool execution cancelled', 'cancelled');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ToolError('Tool execution timed out', 'timeout'));
    }, timeoutMs);
  });

  const abortPromise =
    signal &&
    new Promise<never>((_, reject) => {
      onAbort = () => {
        reject(new ToolError('Tool execution cancelled', 'cancelled'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });

  try {
    const racers: Promise<T>[] = [promise, timeoutPromise];
    if (abortPromise) racers.push(abortPromise);
    return await Promise.race(racers);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Execute a tool with timeout, optional retries, duration, and structured logging.
 * No business logic. Future: parallel batch execution.
 */
export async function executeTool(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolContext,
  options: ToolExecutorOptions = {}
): Promise<ToolResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxRetries = options.maxRetries ?? 0;
  const started = Date.now();

  logTool('info', 'tool execution started', {
    requestId: context.requestId,
    eventId: context.eventId,
    toolName: tool.name,
  });

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      const result = await withTimeout(
        tool.execute(input, context),
        timeoutMs,
        context.signal
      );
      const durationMs =
        typeof result.durationMs === 'number' && result.durationMs >= 0
          ? result.durationMs
          : Date.now() - started;

      const normalized: ToolResult = result.success
        ? { ...result, tool: tool.name, durationMs }
        : { ...result, tool: tool.name, durationMs };

      logTool('info', 'tool execution completed', {
        requestId: context.requestId,
        eventId: context.eventId,
        toolName: tool.name,
        durationMs,
        success: normalized.success,
      });

      return normalized;
    } catch (error) {
      lastError = error;
      const code =
        error instanceof ToolError ? error.code : 'execution_failure';
      const retryable = code === 'timeout' || code === 'execution_failure';
      if (!retryable || attempt >= maxRetries) {
        break;
      }
      attempt += 1;
    }
  }

  const durationMs = Date.now() - started;
  const code =
    lastError instanceof ToolError ? lastError.code : 'unexpected';
  const errorMessage =
    lastError instanceof Error ? lastError.message : 'Tool execution failed';

  logTool('error', 'tool execution failed', {
    requestId: context.requestId,
    eventId: context.eventId,
    toolName: tool.name,
    durationMs,
    errorCode: code,
  });

  return {
    success: false,
    tool: tool.name,
    durationMs,
    errorCode: code,
    errorMessage,
  };
}

import { ToolError } from '@/lib/tools/errors';
import type { Tool, ToolContext, ToolResult } from '@/lib/tools/types';

export type ToolExecutorOptions = {
  /** Per-call timeout (ms). Default 5000. */
  timeoutMs?: number;
  /**
   * Max retries after a settled failed attempt.
   * Retries are allowed only when `tool.idempotent === true`.
   * Default 0.
   */
  maxRetries?: number;
};

type AbortReason = 'timeout' | 'parent' | 'none';

function logTool(
  level: 'info' | 'warn' | 'error',
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
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function isIdempotent(tool: Tool): boolean {
  return tool.idempotent === true;
}

function mapAbortError(reason: AbortReason): ToolError {
  if (reason === 'timeout') {
    return new ToolError('Tool execution timed out', 'timeout');
  }
  return new ToolError('Tool execution cancelled', 'cancelled');
}

/**
 * Run one tool attempt with a dedicated AbortController.
 * Merges parent signal + timeout into one signal passed to the tool.
 * Always awaits tool settlement after abort (no orphan / no concurrent retry).
 */
async function runAttempt(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolContext,
  timeoutMs: number,
  attempt: number
): Promise<ToolResult> {
  const controller = new AbortController();
  let abortReason: AbortReason = 'none';
  const parent = context.signal;

  const requestAbort = (reason: AbortReason) => {
    if (controller.signal.aborted) return;
    abortReason = reason;
    if (reason === 'timeout') {
      logTool('warn', 'timeout', {
        requestId: context.requestId,
        eventId: context.eventId,
        toolName: tool.name,
        attempt,
      });
    }
    logTool('info', 'abort requested', {
      requestId: context.requestId,
      eventId: context.eventId,
      toolName: tool.name,
      attempt,
      reason,
    });
    controller.abort();
  };

  const onParentAbort = () => requestAbort('parent');
  if (parent?.aborted) {
    requestAbort('parent');
  } else if (parent) {
    parent.addEventListener('abort', onParentAbort);
  }

  const timer = setTimeout(() => requestAbort('timeout'), timeoutMs);

  const attemptContext: ToolContext = {
    ...context,
    signal: controller.signal,
  };

  const attemptStarted = Date.now();

  logTool('info', 'tool execution started', {
    requestId: context.requestId,
    eventId: context.eventId,
    toolName: tool.name,
    attempt,
    idempotent: isIdempotent(tool),
  });

  try {
    // Always await settlement — abort must not leave an orphan running under retry.
    const result = await tool.execute(input, attemptContext);

    if (controller.signal.aborted) {
      // Tool returned after abort (or ignored abort until finish). Discard side-effect ambiguity.
      logTool('info', 'tool cancelled', {
        requestId: context.requestId,
        eventId: context.eventId,
        toolName: tool.name,
        attempt,
        durationMs: Date.now() - attemptStarted,
        reason: abortReason,
      });
      throw mapAbortError(abortReason);
    }

    const durationMs =
      typeof result.durationMs === 'number' && result.durationMs >= 0
        ? result.durationMs
        : Date.now() - attemptStarted;

    return result.success
      ? { ...result, tool: tool.name, durationMs }
      : { ...result, tool: tool.name, durationMs };
  } catch (error) {
    if (controller.signal.aborted) {
      logTool('info', 'tool cancelled', {
        requestId: context.requestId,
        eventId: context.eventId,
        toolName: tool.name,
        attempt,
        durationMs: Date.now() - attemptStarted,
        reason: abortReason,
      });
      throw mapAbortError(abortReason);
    }
    if (error instanceof ToolError) {
      throw error;
    }
    throw new ToolError(
      error instanceof Error ? error.message : 'Tool execution failed',
      'unexpected',
      tool.name
    );
  } finally {
    clearTimeout(timer);
    if (parent) {
      parent.removeEventListener('abort', onParentAbort);
    }
  }
}

function canRetry(
  tool: Tool,
  error: unknown,
  attempt: number,
  maxRetries: number
): boolean {
  if (attempt >= maxRetries) return false;
  if (!isIdempotent(tool)) return false;

  const code = error instanceof ToolError ? error.code : 'unexpected';
  // Parent cancellation is final — never retry.
  if (code === 'cancelled') return false;
  // Timeout / transient execution failures may retry only for idempotent tools
  // (and only after the previous attempt has fully settled).
  return code === 'timeout' || code === 'execution_failure';
}

/**
 * Execute a tool with cooperative cancellation, timeout abort, and safe retries.
 *
 * Guarantees:
 * - Every attempt gets its own AbortController (parent + timeout merged).
 * - Timeout / parent abort calls `controller.abort()` before returning failure.
 * - Previous attempt is always settled before any retry (no concurrent duplicate).
 * - Non-idempotent tools never retry.
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

  let attempt = 0;
  let lastError: unknown;

  while (true) {
    try {
      const result = await runAttempt(
        tool,
        input,
        context,
        timeoutMs,
        attempt
      );

      logTool('info', 'tool execution completed', {
        requestId: context.requestId,
        eventId: context.eventId,
        toolName: tool.name,
        attempt,
        durationMs: result.durationMs,
        success: result.success,
      });

      return result;
    } catch (error) {
      lastError = error;

      if (canRetry(tool, error, attempt, maxRetries)) {
        logTool('info', 'retry', {
          requestId: context.requestId,
          eventId: context.eventId,
          toolName: tool.name,
          attempt,
          nextAttempt: attempt + 1,
          errorCode:
            error instanceof ToolError ? error.code : 'unexpected',
        });
        attempt += 1;
        continue;
      }

      break;
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
    attempt,
    durationMs,
    errorCode: code,
    idempotent: isIdempotent(tool),
  });

  return {
    success: false,
    tool: tool.name,
    durationMs,
    errorCode: code,
    errorMessage,
  };
}

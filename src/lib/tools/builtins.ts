import type { JsonValue, Tool, ToolResult } from '@/lib/tools/types';
import { ToolError } from '@/lib/tools/errors';

function success(
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

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ToolError('Tool execution cancelled', 'cancelled');
  }
}

/** Demonstration tool: returns pong. Safe to retry. */
export const pingTool: Tool = {
  name: 'ping',
  description: 'Health check. Returns pong. Use when the user says ping.',
  version: '1.0.0',
  idempotent: true,
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(_input, context) {
    assertNotAborted(context.signal);
    const started = Date.now();
    return success('ping', started, { message: 'pong' });
  },
};

/** Demonstration tool: current server time. Safe to retry. */
export const currentTimeTool: Tool = {
  name: 'current_time',
  description:
    'Returns the current server time. Use when the user asks what time it is.',
  version: '1.0.0',
  idempotent: true,
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(_input, context) {
    assertNotAborted(context.signal);
    const started = Date.now();
    const now = new Date();
    return success('current_time', started, {
      iso: now.toISOString(),
      time: now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short',
      }),
      epochMs: now.getTime(),
    });
  },
};

/** Demonstration tool: current server date. Safe to retry. */
export const currentDateTool: Tool = {
  name: 'current_date',
  description:
    'Returns the current server date. Use when the user asks for the date.',
  version: '1.0.0',
  idempotent: true,
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(_input, context) {
    assertNotAborted(context.signal);
    const started = Date.now();
    const now = new Date();
    return success('current_date', started, {
      isoDate: now.toISOString().slice(0, 10),
      date: now.toLocaleDateString('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
      weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
    });
  },
};

export const BUILTIN_TOOLS: Tool[] = [
  pingTool,
  currentTimeTool,
  currentDateTool,
];

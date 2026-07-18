/**
 * Vendor-agnostic tool framework types (OpenAI / MCP / local / REST ready).
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ToolInputSchema = {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolContext = {
  requestId?: string;
  eventId?: string;
  userId?: string;
  slackChannel?: string;
  metadata?: Record<string, string | undefined>;
  /** Future: tenant, locale, permissions */
  signal?: AbortSignal;
};

export type ToolResultSuccess = {
  success: true;
  tool: string;
  durationMs: number;
  result: JsonValue;
  metadata?: Record<string, JsonValue>;
};

export type ToolResultFailure = {
  success: false;
  tool: string;
  durationMs: number;
  errorCode: string;
  errorMessage?: string;
  metadata?: Record<string, JsonValue>;
};

export type ToolResult = ToolResultSuccess | ToolResultFailure;

export interface Tool {
  name: string;
  description: string;
  version: string;
  /**
   * When true, the executor may retry after a settled timeout / transient failure.
   * Default: false (business tools must opt in after review).
   */
  readonly idempotent?: boolean;
  /** JSON Schema for arguments (OpenAI / MCP compatible shape) */
  inputSchema?: ToolInputSchema;
  /**
   * Execute the tool. Implementations MUST honor `context.signal` (cooperative cancel).
   */
  execute(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult>;
}

/** Normalized tool invocation request (LLM-vendor agnostic). */
export type ToolInvocationRequest = {
  id: string;
  name: string;
  /** Raw JSON arguments string or already-parsed object */
  arguments: string | Record<string, unknown>;
};

/** OpenAI-style tool definition for chat.completions `tools` array. */
export type LlmToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolInputSchema;
  };
};

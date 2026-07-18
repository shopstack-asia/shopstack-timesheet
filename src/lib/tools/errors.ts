export type ToolErrorCode =
  | 'unknown_tool'
  | 'validation_error'
  | 'timeout'
  | 'execution_failure'
  | 'cancelled'
  | 'unexpected';

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly toolName?: string;

  constructor(message: string, code: ToolErrorCode, toolName?: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.toolName = toolName;
  }
}

import { ToolError, type ToolErrorCode } from '@/lib/tools/errors';
import { executeTool, type ToolExecutorOptions } from '@/lib/tools/executor';
import { assertValidToolName, type ToolRegistry } from '@/lib/tools/registry';
import type {
  ToolContext,
  ToolInvocationRequest,
  ToolResult,
} from '@/lib/tools/types';

export type ToolRouter = {
  route(
    request: ToolInvocationRequest,
    context: ToolContext,
    executorOptions?: ToolExecutorOptions
  ): Promise<ToolResult>;
};

function parseArguments(
  raw: string | Record<string, unknown>,
  toolName: string
): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ToolError(
        'Tool arguments must be a JSON object',
        'validation_error',
        toolName
      );
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(
      'Invalid tool arguments JSON',
      'validation_error',
      toolName
    );
  }
}

/**
 * Validate tool request → resolve from registry → execute.
 * No business logic.
 */
export function createToolRouter(registry: ToolRegistry): ToolRouter {
  return {
    async route(request, context, executorOptions) {
      console.log(
        JSON.stringify({
          scope: 'tools',
          level: 'info',
          message: 'tool requested',
          requestId: context.requestId,
          eventId: context.eventId,
          toolName: request.name,
          toolCallId: request.id,
          ts: new Date().toISOString(),
        })
      );

      try {
        assertValidToolName(request.name);
      } catch (error) {
        const code: ToolErrorCode =
          error instanceof ToolError ? error.code : 'validation_error';
        return {
          success: false,
          tool: request.name,
          durationMs: 0,
          errorCode: code,
          errorMessage:
            error instanceof Error ? error.message : 'Invalid tool name',
        };
      }

      const tool = registry.get(request.name);
      if (!tool) {
        console.log(
          JSON.stringify({
            scope: 'tools',
            level: 'warn',
            message: 'unknown tool rejected',
            requestId: context.requestId,
            eventId: context.eventId,
            toolName: request.name,
            ts: new Date().toISOString(),
          })
        );
        return {
          success: false,
          tool: request.name,
          durationMs: 0,
          errorCode: 'unknown_tool',
          errorMessage: `Unknown tool: ${request.name}`,
        };
      }

      let input: Record<string, unknown>;
      try {
        input = parseArguments(request.arguments, request.name);
      } catch (error) {
        return {
          success: false,
          tool: request.name,
          durationMs: 0,
          errorCode:
            error instanceof ToolError ? error.code : 'validation_error',
          errorMessage:
            error instanceof Error ? error.message : 'Invalid arguments',
        };
      }

      const result = await executeTool(tool, input, context, executorOptions);

      console.log(
        JSON.stringify({
          scope: 'tools',
          level: 'info',
          message: 'tool returned',
          requestId: context.requestId,
          eventId: context.eventId,
          toolName: request.name,
          success: result.success,
          durationMs: result.durationMs,
          ts: new Date().toISOString(),
        })
      );

      return result;
    },
  };
}

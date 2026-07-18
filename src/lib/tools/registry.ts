import { ToolError } from '@/lib/tools/errors';
import type { LlmToolDefinition, Tool } from '@/lib/tools/types';

const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

export function assertValidToolName(name: string): void {
  if (!TOOL_NAME_RE.test(name)) {
    throw new ToolError(
      `Invalid tool name: ${name}`,
      'validation_error',
      name
    );
  }
}

export type ToolRegistry = {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
  exists(name: string): boolean;
  /** OpenAI / MCP-compatible tool definitions */
  toLlmToolDefinitions(): LlmToolDefinition[];
};

/**
 * Create an isolated tool registry (dependency injection; no process globals).
 */
export function createToolRegistry(initial: Tool[] = []): ToolRegistry {
  const tools = new Map<string, Tool>();

  const registry: ToolRegistry = {
    register(tool) {
      assertValidToolName(tool.name);
      if (!tool.description?.trim()) {
        throw new ToolError(
          `Tool ${tool.name} missing description`,
          'validation_error',
          tool.name
        );
      }
      if (!tool.version?.trim()) {
        throw new ToolError(
          `Tool ${tool.name} missing version`,
          'validation_error',
          tool.name
        );
      }
      if (typeof tool.execute !== 'function') {
        throw new ToolError(
          `Tool ${tool.name} missing execute()`,
          'validation_error',
          tool.name
        );
      }
      tools.set(tool.name, tool);
    },
    get(name) {
      return tools.get(name);
    },
    list() {
      return Array.from(tools.values());
    },
    exists(name) {
      return tools.has(name);
    },
    toLlmToolDefinitions() {
      return registry.list().map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema ?? {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      }));
    },
  };

  for (const tool of initial) {
    registry.register(tool);
  }

  return registry;
}

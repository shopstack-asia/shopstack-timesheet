import { BUILTIN_TOOLS } from '@/lib/tools/builtins';
import { BUSINESS_READ_TOOLS } from '@/lib/tools/business';
import { createToolRegistry, type ToolRegistry } from '@/lib/tools/registry';
import { createToolRouter, type ToolRouter } from '@/lib/tools/router';

export * from '@/lib/tools/types';
export * from '@/lib/tools/errors';
export * from '@/lib/tools/tool-context';
export * from '@/lib/tools/registry';
export * from '@/lib/tools/executor';
export * from '@/lib/tools/router';
export * from '@/lib/tools/builtins';
export * from '@/lib/tools/business';

/** Default registry: demo tools + Phase 9.2 read-only business tools. */
export function createDefaultToolRegistry(): ToolRegistry {
  return createToolRegistry([...BUILTIN_TOOLS, ...BUSINESS_READ_TOOLS]);
}

export function createDefaultToolRouter(
  registry: ToolRegistry = createDefaultToolRegistry()
): ToolRouter {
  return createToolRouter(registry);
}

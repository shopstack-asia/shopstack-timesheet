import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_TOOLS,
  createDefaultToolRegistry,
  createToolRegistry,
  createToolRouter,
  createToolContext,
  executeTool,
  pingTool,
  currentTimeTool,
  currentDateTool,
  ToolError,
  type Tool,
} from '@/lib/tools';

describe('ToolRegistry', () => {
  it('registers, gets, lists, exists', () => {
    const registry = createToolRegistry();
    expect(registry.exists('ping')).toBe(false);
    registry.register(pingTool);
    expect(registry.exists('ping')).toBe(true);
    expect(registry.get('ping')).toBe(pingTool);
    expect(registry.list()).toHaveLength(1);
  });

  it('rejects invalid tool names', () => {
    const registry = createToolRegistry();
    expect(() =>
      registry.register({
        ...pingTool,
        name: 'Bad-Name',
      })
    ).toThrow(ToolError);
  });

  it('rejects missing description', () => {
    const registry = createToolRegistry();
    expect(() =>
      registry.register({
        ...pingTool,
        name: 'demo',
        description: '  ',
      })
    ).toThrow(/description/);
  });

  it('createDefaultToolRegistry includes demonstration tools only', () => {
    const registry = createDefaultToolRegistry();
    const names = registry.list().map((t) => t.name).sort();
    expect(names).toEqual(['current_date', 'current_time', 'ping']);
    expect(registry.toLlmToolDefinitions()).toHaveLength(3);
  });

  it('isolates registries (no global mutable state)', () => {
    const a = createToolRegistry([pingTool]);
    const b = createToolRegistry();
    expect(a.exists('ping')).toBe(true);
    expect(b.exists('ping')).toBe(false);
  });
});

describe('builtin tools', () => {
  it('ping returns pong', async () => {
    const result = await pingTool.execute({}, createToolContext());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toEqual({ message: 'pong' });
      expect(result.tool).toBe('ping');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('current_time returns iso and time', async () => {
    const result = await currentTimeTool.execute({}, createToolContext());
    expect(result.success).toBe(true);
    if (result.success) {
      const r = result.result as { iso: string; time: string; epochMs: number };
      expect(r.iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof r.time).toBe('string');
      expect(typeof r.epochMs).toBe('number');
    }
  });

  it('current_date returns date fields', async () => {
    const result = await currentDateTool.execute({}, createToolContext());
    expect(result.success).toBe(true);
    if (result.success) {
      const r = result.result as { isoDate: string; date: string };
      expect(r.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.date).toBeTruthy();
    }
  });
});

describe('ToolExecutor', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records duration and success', async () => {
    const result = await executeTool(
      pingTool,
      {},
      createToolContext({ requestId: 'r1', eventId: 'e1' })
    );
    expect(result.success).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('maps timeout', async () => {
    const slow: Tool = {
      name: 'slow',
      description: 'slow tool',
      version: '1.0.0',
      async execute() {
        await new Promise((r) => setTimeout(r, 200));
        return {
          success: true,
          tool: 'slow',
          durationMs: 200,
          result: {},
        };
      },
    };
    const result = await executeTool(
      slow,
      {},
      createToolContext(),
      { timeoutMs: 20, maxRetries: 0 }
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('timeout');
    }
  });

  it('maps unexpected exceptions', async () => {
    const bad: Tool = {
      name: 'bad',
      description: 'throws',
      version: '1.0.0',
      async execute() {
        throw new Error('boom');
      },
    };
    const result = await executeTool(bad, {}, createToolContext());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('unexpected');
    }
  });

  it('supports cancellation via AbortSignal', async () => {
    const ac = new AbortController();
    const slow: Tool = {
      name: 'cancelme',
      description: 'slow',
      version: '1.0.0',
      async execute() {
        await new Promise((r) => setTimeout(r, 500));
        return {
          success: true,
          tool: 'cancelme',
          durationMs: 500,
          result: {},
        };
      },
    };
    const promise = executeTool(
      slow,
      {},
      createToolContext({ signal: ac.signal }),
      { timeoutMs: 5_000 }
    );
    ac.abort();
    const result = await promise;
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('cancelled');
    }
  });
});

describe('ToolRouter', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes known tool', async () => {
    const router = createToolRouter(createDefaultToolRegistry());
    const result = await router.route(
      { id: 'call_1', name: 'ping', arguments: '{}' },
      createToolContext({ requestId: 'r1' })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toEqual({ message: 'pong' });
    }
  });

  it('rejects unknown tool', async () => {
    const router = createToolRouter(createDefaultToolRegistry());
    const result = await router.route(
      { id: 'call_1', name: 'timesheet_submit', arguments: '{}' },
      createToolContext()
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('unknown_tool');
    }
  });

  it('rejects invalid tool name format', async () => {
    const router = createToolRouter(createDefaultToolRegistry());
    const result = await router.route(
      { id: 'call_1', name: 'Evil;drop', arguments: '{}' },
      createToolContext()
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('validation_error');
    }
  });

  it('rejects invalid JSON arguments', async () => {
    const router = createToolRouter(createDefaultToolRegistry());
    const result = await router.route(
      { id: 'call_1', name: 'ping', arguments: '{not-json' },
      createToolContext()
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('validation_error');
    }
  });

  it('accepts already-parsed arguments object', async () => {
    const router = createToolRouter(createDefaultToolRegistry());
    const result = await router.route(
      { id: 'call_1', name: 'ping', arguments: {} },
      createToolContext()
    );
    expect(result.success).toBe(true);
  });
});

describe('BUILTIN_TOOLS security posture', () => {
  it('does not include business tools', () => {
    const names = BUILTIN_TOOLS.map((t) => t.name);
    expect(names).not.toContain('timesheet');
    expect(names).not.toContain('leave');
    expect(names).not.toContain('holiday');
  });
});

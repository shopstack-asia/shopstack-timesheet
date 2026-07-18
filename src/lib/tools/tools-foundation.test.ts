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
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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

  it('timeout aborts execution via context.signal', async () => {
    let sawAbort = false;
    const slow: Tool = {
      name: 'slow_abort',
      description: 'cooperative slow',
      version: '1.0.0',
      idempotent: true,
      async execute(_input, context) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => resolve(), 5_000);
          context.signal?.addEventListener(
            'abort',
            () => {
              sawAbort = true;
              clearTimeout(timer);
              reject(new ToolError('aborted', 'cancelled'));
            },
            { once: true }
          );
        });
        return {
          success: true,
          tool: 'slow_abort',
          durationMs: 0,
          result: {},
        };
      },
    };

    const result = await executeTool(
      slow,
      {},
      createToolContext({ requestId: 'r1', eventId: 'e1' }),
      { timeoutMs: 30, maxRetries: 0 }
    );
    expect(sawAbort).toBe(true);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('timeout');
    }
  });

  it('cancelled tool never continues after abort', async () => {
    let continuedAfterAbort = false;
    const tool: Tool = {
      name: 'watch_abort',
      description: 'tracks post-abort work',
      version: '1.0.0',
      async execute(_input, context) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => resolve(), 5_000);
          context.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new ToolError('aborted', 'cancelled'));
            },
            { once: true }
          );
        });
        continuedAfterAbort = true;
        return {
          success: true,
          tool: 'watch_abort',
          durationMs: 0,
          result: {},
        };
      },
    };

    const result = await executeTool(tool, {}, createToolContext(), {
      timeoutMs: 25,
      maxRetries: 0,
    });
    expect(continuedAfterAbort).toBe(false);
    expect(result.success).toBe(false);
  });

  it('idempotent tool retries after timeout', async () => {
    let attempts = 0;
    const tool: Tool = {
      name: 'flaky_idempotent',
      description: 'fails once then ok',
      version: '1.0.0',
      idempotent: true,
      async execute(_input, context) {
        attempts += 1;
        if (attempts === 1) {
          await new Promise<void>((_resolve, reject) => {
            const timer = setTimeout(() => _resolve(), 5_000);
            context.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new ToolError('aborted', 'cancelled'));
              },
              { once: true }
            );
          });
        }
        return {
          success: true,
          tool: 'flaky_idempotent',
          durationMs: 1,
          result: { attempts },
        };
      },
    };

    const result = await executeTool(tool, {}, createToolContext(), {
      timeoutMs: 30,
      maxRetries: 1,
    });
    expect(result.success).toBe(true);
    expect(attempts).toBe(2);
  });

  it('non-idempotent tool does not retry after timeout', async () => {
    let attempts = 0;
    const tool: Tool = {
      name: 'write_once',
      description: 'non-idempotent',
      version: '1.0.0',
      // idempotent defaults to false
      async execute(_input, context) {
        attempts += 1;
        await new Promise<void>((_resolve, reject) => {
          const timer = setTimeout(() => _resolve(), 5_000);
          context.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new ToolError('aborted', 'cancelled'));
            },
            { once: true }
          );
        });
        return {
          success: true,
          tool: 'write_once',
          durationMs: 1,
          result: {},
        };
      },
    };

    const result = await executeTool(tool, {}, createToolContext(), {
      timeoutMs: 30,
      maxRetries: 3,
    });
    expect(attempts).toBe(1);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('timeout');
    }
  });

  it('parent abort propagates to tool signal', async () => {
    const parent = new AbortController();
    let toolSawAbort = false;
    const tool: Tool = {
      name: 'parent_abort',
      description: 'parent abort',
      version: '1.0.0',
      async execute(_input, context) {
        await new Promise<void>((_resolve, reject) => {
          context.signal?.addEventListener(
            'abort',
            () => {
              toolSawAbort = true;
              reject(new ToolError('aborted', 'cancelled'));
            },
            { once: true }
          );
        });
        return {
          success: true,
          tool: 'parent_abort',
          durationMs: 0,
          result: {},
        };
      },
    };

    const promise = executeTool(
      tool,
      {},
      createToolContext({ signal: parent.signal }),
      { timeoutMs: 5_000, maxRetries: 0 }
    );
    await new Promise((r) => setTimeout(r, 10));
    parent.abort();
    const result = await promise;
    expect(toolSawAbort).toBe(true);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('cancelled');
    }
  });

  it('timeout propagates as timeout errorCode', async () => {
    const tool: Tool = {
      name: 'timeout_prop',
      description: 'timeout',
      version: '1.0.0',
      async execute(_input, context) {
        await new Promise<void>((_resolve, reject) => {
          context.signal?.addEventListener(
            'abort',
            () => reject(new ToolError('aborted', 'cancelled')),
            { once: true }
          );
        });
        return {
          success: true,
          tool: 'timeout_prop',
          durationMs: 0,
          result: {},
        };
      },
    };
    const result = await executeTool(tool, {}, createToolContext(), {
      timeoutMs: 20,
      maxRetries: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('timeout');
    }
  });

  it('prevents duplicate concurrent executions across retries', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let attempts = 0;
    const tool: Tool = {
      name: 'no_dup',
      description: 'tracks concurrency',
      version: '1.0.0',
      idempotent: true,
      async execute(_input, context) {
        attempts += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        try {
          if (attempts === 1) {
            await new Promise<void>((_resolve, reject) => {
              const timer = setTimeout(() => _resolve(), 5_000);
              context.signal?.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer);
                  reject(new ToolError('aborted', 'cancelled'));
                },
                { once: true }
              );
            });
          }
          return {
            success: true,
            tool: 'no_dup',
            durationMs: 1,
            result: {},
          };
        } finally {
          concurrent -= 1;
        }
      },
    };

    const result = await executeTool(tool, {}, createToolContext(), {
      timeoutMs: 30,
      maxRetries: 1,
    });
    expect(result.success).toBe(true);
    expect(maxConcurrent).toBe(1);
    expect(attempts).toBe(2);
  });

  it('executor cleanup clears timeout after success', async () => {
    const result = await executeTool(
      pingTool,
      {},
      createToolContext(),
      { timeoutMs: 5_000 }
    );
    expect(result.success).toBe(true);
    // No hanging timers should fire abort logs after completion
    await new Promise((r) => setTimeout(r, 20));
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

  it('does not retry parent cancellation even when idempotent', async () => {
    let attempts = 0;
    const parent = new AbortController();
    const tool: Tool = {
      name: 'no_retry_cancel',
      description: 'idempotent but parent cancelled',
      version: '1.0.0',
      idempotent: true,
      async execute(_input, context) {
        attempts += 1;
        await new Promise<void>((_resolve, reject) => {
          context.signal?.addEventListener(
            'abort',
            () => reject(new ToolError('aborted', 'cancelled')),
            { once: true }
          );
        });
        return {
          success: true,
          tool: 'no_retry_cancel',
          durationMs: 0,
          result: {},
        };
      },
    };
    const promise = executeTool(
      tool,
      {},
      createToolContext({ signal: parent.signal }),
      { timeoutMs: 5_000, maxRetries: 2 }
    );
    await new Promise((r) => setTimeout(r, 10));
    parent.abort();
    const result = await promise;
    expect(attempts).toBe(1);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('cancelled');
    }
  });

  it('builtin demo tools are marked idempotent', () => {
    expect(pingTool.idempotent).toBe(true);
    expect(currentTimeTool.idempotent).toBe(true);
    expect(currentDateTool.idempotent).toBe(true);
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

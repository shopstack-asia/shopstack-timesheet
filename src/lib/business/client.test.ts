import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBearerTokenProvider } from '@/lib/business/auth';
import {
  assertBusinessApiConfigOnStartup,
  loadBusinessApiConfig,
} from '@/lib/business/config';
import {
  createBusinessApiClient,
  resetBusinessApiClient,
  shouldRetryBusinessRequest,
} from '@/lib/business/client';
import {
  AuthenticationError,
  BusinessApiError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from '@/lib/business/errors';
import {
  resolveRequestIdempotent,
  type BusinessApiConfig,
} from '@/lib/business/types';

function testConfig(
  overrides: Partial<BusinessApiConfig> = {}
): BusinessApiConfig {
  return {
    baseUrl: 'https://api.example.com',
    timeoutMs: 5_000,
    apiKey: 'test-secret-key',
    maxRetries: 2,
    logging: true,
    ...overrides,
  };
}

describe('resolveRequestIdempotent / shouldRetryBusinessRequest', () => {
  it('defaults GET true and POST/PATCH false', () => {
    expect(resolveRequestIdempotent('GET')).toBe(true);
    expect(resolveRequestIdempotent('HEAD')).toBe(true);
    expect(resolveRequestIdempotent('OPTIONS')).toBe(true);
    expect(resolveRequestIdempotent('POST')).toBe(false);
    expect(resolveRequestIdempotent('PATCH')).toBe(false);
    expect(resolveRequestIdempotent('PUT')).toBe(false);
    expect(resolveRequestIdempotent('DELETE')).toBe(false);
  });

  it('explicit idempotent overrides method default', () => {
    expect(resolveRequestIdempotent('POST', true)).toBe(true);
    expect(resolveRequestIdempotent('GET', false)).toBe(false);
  });

  it('retry policy requires idempotent + retryable error', () => {
    const timeout = new TimeoutError();
    expect(shouldRetryBusinessRequest(true, timeout, 0, 2)).toBe(true);
    expect(shouldRetryBusinessRequest(false, timeout, 0, 2)).toBe(false);
    expect(
      shouldRetryBusinessRequest(true, new AuthenticationError(), 0, 2)
    ).toBe(false);
  });
});

describe('loadBusinessApiConfig', () => {
  it('requires base URL and API key', () => {
    expect(() => loadBusinessApiConfig({})).toThrow(BusinessApiError);
    expect(() =>
      loadBusinessApiConfig({ BUSINESS_API_BASE_URL: 'https://x' })
    ).toThrow(/BUSINESS_API_KEY/);
  });

  it('loads defaults', () => {
    const cfg = loadBusinessApiConfig({
      BUSINESS_API_BASE_URL: 'https://timesheet-api.example/',
      BUSINESS_API_KEY: 'k',
    });
    expect(cfg.baseUrl).toBe('https://timesheet-api.example');
    expect(cfg.timeoutMs).toBe(15_000);
    expect(cfg.maxRetries).toBe(2);
    expect(cfg.logging).toBe(true);
  });

  it('parses retry and logging', () => {
    const cfg = loadBusinessApiConfig({
      BUSINESS_API_BASE_URL: 'https://x',
      BUSINESS_API_KEY: 'k',
      BUSINESS_API_RETRY: '1',
      BUSINESS_API_TIMEOUT_MS: '2000',
      BUSINESS_API_LOGGING: 'false',
    });
    expect(cfg.maxRetries).toBe(1);
    expect(cfg.timeoutMs).toBe(2000);
    expect(cfg.logging).toBe(false);
  });
});

describe('assertBusinessApiConfigOnStartup', () => {
  it('skips when no business env', () => {
    expect(() => assertBusinessApiConfigOnStartup({})).not.toThrow();
  });

  it('validates when key present', () => {
    expect(() =>
      assertBusinessApiConfigOnStartup({
        BUSINESS_API_BASE_URL: 'https://x',
        BUSINESS_API_KEY: 'k',
      })
    ).not.toThrow();
  });
});

describe('BusinessApiClient', () => {
  beforeEach(() => {
    resetBusinessApiClient();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET returns ApiResponse with data', async () => {
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig(),
      fetchImpl: async ({ method, url, headers }) => {
        expect(method).toBe('GET');
        expect(url).toContain('/timesheets/week');
        expect(headers.Authorization).toBe('Bearer test-secret-key');
        expect(headers['X-Request-Id']).toBeTruthy();
        return {
          status: 200,
          bodyText: JSON.stringify({ week: '2026-W29' }),
        };
      },
    });

    const res = await client.get<{ week: string }>('/timesheets/week', {
      requestId: 'req-1',
      query: { staffId: 'S1' },
    });
    expect(res.success).toBe(true);
    expect(res.data.week).toBe('2026-W29');
    expect(res.status).toBe(200);
    expect(res.requestId).toBe('req-1');
  });

  it('POST sends JSON body', async () => {
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig(),
      fetchImpl: async ({ method, body, headers }) => {
        expect(method).toBe('POST');
        expect(headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(body || '{}')).toEqual({ hours: 8 });
        return { status: 201, bodyText: JSON.stringify({ id: 'e1' }) };
      },
    });

    const res = await client.post<{ id: string }>('/entries', { hours: 8 });
    expect(res.data.id).toBe('e1');
    expect(res.status).toBe(201);
  });

  it('PUT / PATCH / DELETE methods work', async () => {
    const methods: string[] = [];
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 0 }),
      fetchImpl: async ({ method }) => {
        methods.push(method);
        return { status: 200, bodyText: '{}' };
      },
    });
    await client.put('/x', { a: 1 });
    await client.patch('/x', { a: 2 });
    await client.delete('/x');
    expect(methods).toEqual(['PUT', 'PATCH', 'DELETE']);
  });

  it('parses { data } envelope', async () => {
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig(),
      fetchImpl: async () => ({
        status: 200,
        bodyText: JSON.stringify({ success: true, data: { ok: true } }),
      }),
    });
    const res = await client.get<{ ok: boolean }>('/ping');
    expect(res.data.ok).toBe(true);
  });

  it('maps 401 to AuthenticationError (no retry)', async () => {
    let calls = 0;
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 2 }),
      fetchImpl: async () => {
        calls += 1;
        return {
          status: 401,
          bodyText: JSON.stringify({ error: 'unauthorized' }),
        };
      },
    });
    await expect(client.get('/secure')).rejects.toBeInstanceOf(
      AuthenticationError
    );
    expect(calls).toBe(1);
  });

  it('maps 404 / 400 without retry', async () => {
    const notFound = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 2 }),
      fetchImpl: async () => ({
        status: 404,
        bodyText: JSON.stringify({ message: 'gone' }),
      }),
    });
    await expect(notFound.get('/missing')).rejects.toBeInstanceOf(NotFoundError);

    const bad = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 2 }),
      fetchImpl: async () => ({
        status: 400,
        bodyText: JSON.stringify({ error: { message: 'invalid' } }),
      }),
    });
    await expect(bad.post('/x', {})).rejects.toBeInstanceOf(ValidationError);
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 2 }),
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return { status: 429, bodyText: '{"error":"slow"}' };
        }
        return { status: 200, bodyText: '{"ok":true}' };
      },
    });
    const res = await client.get<{ ok: boolean }>('/retry');
    expect(res.data.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('GET retries on 503', async () => {
    let calls = 0;
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 1 }),
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return { status: 503, bodyText: 'down' };
        return { status: 200, bodyText: '{"v":1}' };
      },
    });
    const res = await client.get<{ v: number }>('/gw');
    expect(res.data.v).toBe(1);
    expect(calls).toBe(2);
  });

  it('POST does not retry on timeout or 429', async () => {
    let calls = 0;
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 3 }),
      fetchImpl: async () => {
        calls += 1;
        return { status: 429, bodyText: 'slow' };
      },
    });
    await expect(client.post('/timesheets', { hours: 8 })).rejects.toBeInstanceOf(
      RateLimitError
    );
    expect(calls).toBe(1);
  });

  it('PATCH does not retry on 503', async () => {
    let calls = 0;
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 3 }),
      fetchImpl: async () => {
        calls += 1;
        return { status: 503, bodyText: 'down' };
      },
    });
    await expect(client.patch('/entries/1', { hours: 4 })).rejects.toMatchObject({
      retryable: true,
    });
    expect(calls).toBe(1);
  });

  it('PUT is not retried by default; retries when idempotent: true', async () => {
    let calls = 0;
    const defaultClient = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 2 }),
      fetchImpl: async () => {
        calls += 1;
        return { status: 429, bodyText: 'slow' };
      },
    });
    await expect(defaultClient.put('/entries/1', { hours: 1 })).rejects.toBeInstanceOf(
      RateLimitError
    );
    expect(calls).toBe(1);

    calls = 0;
    const idempotentClient = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 1 }),
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return { status: 429, bodyText: 'slow' };
        return { status: 200, bodyText: '{"ok":true}' };
      },
    });
    const res = await idempotentClient.put(
      '/entries/1',
      { hours: 1 },
      { idempotent: true }
    );
    expect(res.data).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('DELETE is not retried by default; retries when idempotent: true', async () => {
    let calls = 0;
    const defaultClient = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 2 }),
      fetchImpl: async () => {
        calls += 1;
        return { status: 503, bodyText: 'down' };
      },
    });
    await expect(defaultClient.delete('/entries/1')).rejects.toMatchObject({
      retryable: true,
    });
    expect(calls).toBe(1);

    calls = 0;
    const idempotentClient = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 1 }),
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return { status: 503, bodyText: 'down' };
        return { status: 200, bodyText: '{}' };
      },
    });
    await idempotentClient.delete('/entries/1', { idempotent: true });
    expect(calls).toBe(2);
  });

  it('injects Idempotency-Key header when supplied', async () => {
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig(),
      fetchImpl: async ({ headers }) => {
        expect(headers['Idempotency-Key']).toBe('create-ts-abc');
        return { status: 201, bodyText: '{"id":"1"}' };
      },
    });
    await client.post(
      '/timesheets',
      { hours: 8 },
      { idempotencyKey: 'create-ts-abc' }
    );
  });

  it('logs idempotent and retryAttempt fields', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      logs.push(String(msg));
    });
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ logging: true }),
      fetchImpl: async () => ({ status: 200, bodyText: '{}' }),
    });
    await client.get('/x', { idempotencyKey: 'ik-1' });
    const joined = logs.join('\n');
    expect(joined).toContain('"idempotent":true');
    expect(joined).toContain('"retryAttempt":0');
    expect(joined).toContain('"idempotencyKey":"ik-1"');
  });

  it('timeout aborts and is retryable for idempotent GET', async () => {
    let calls = 0;
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ timeoutMs: 30, maxRetries: 1 }),
      fetchImpl: async ({ signal }) => {
        calls += 1;
        await new Promise<void>((_resolve, reject) => {
          const t = setTimeout(() => _resolve(), 5_000);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(t);
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            },
            { once: true }
          );
        });
        return { status: 200, bodyText: '{}' };
      },
    });
    await expect(client.get('/slow')).rejects.toBeInstanceOf(TimeoutError);
    expect(calls).toBe(2);
  });

  it('parent abort fails without treating as timeout retry storm', async () => {
    const parent = new AbortController();
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ timeoutMs: 5_000, maxRetries: 2 }),
      fetchImpl: async ({ signal }) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            },
            { once: true }
          );
        });
        return { status: 200, bodyText: '{}' };
      },
    });
    const promise = client.get('/x', { signal: parent.signal });
    await new Promise((r) => setTimeout(r, 10));
    parent.abort();
    await expect(promise).rejects.toBeInstanceOf(BusinessApiError);
  });

  it('uses injected auth provider', async () => {
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig(),
      auth: createBearerTokenProvider('injected-token'),
      fetchImpl: async ({ headers }) => {
        expect(headers.Authorization).toBe('Bearer injected-token');
        return { status: 200, bodyText: '{}' };
      },
    });
    await client.get('/auth-check');
  });

  it('logs request lifecycle without secrets', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      logs.push(String(msg));
    });

    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ logging: true }),
      fetchImpl: async () => ({
        status: 200,
        bodyText: '{"ok":true}',
      }),
    });
    await client.get('/logged', { requestId: 'log-1' });

    const joined = logs.join('\n');
    expect(joined).toContain('request started');
    expect(joined).toContain('response received');
    expect(joined).toContain('log-1');
    expect(joined).not.toContain('test-secret-key');
    expect(joined).not.toContain('Bearer test-secret-key');
  });

  it('does not retry 409 conflict', async () => {
    let calls = 0;
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 3 }),
      fetchImpl: async () => {
        calls += 1;
        return { status: 409, bodyText: '{"error":"exists"}' };
      },
    });
    await expect(client.post('/dup', {})).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(calls).toBe(1);
  });

  it('surfaces RateLimitError type on exhausted 429', async () => {
    const client = createBusinessApiClient({
      forceNew: true,
      config: testConfig({ maxRetries: 0 }),
      fetchImpl: async () => ({ status: 429, bodyText: 'slow' }),
    });
    await expect(client.get('/rl')).rejects.toBeInstanceOf(RateLimitError);
  });
});

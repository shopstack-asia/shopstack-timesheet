import {
  createBearerTokenProvider,
  type AuthProvider,
} from '@/lib/business/auth';
import { loadBusinessApiConfig } from '@/lib/business/config';
import {
  BusinessApiError,
  isRetryableBusinessError,
  mapHttpStatusToError,
  NetworkError,
  TimeoutError,
  UnexpectedApiError,
} from '@/lib/business/errors';
import { logBusinessApi } from '@/lib/business/logger';
import type {
  ApiResponse,
  BusinessApiConfig,
  BusinessFetchImpl,
  BusinessRequestOptions,
  HttpMethod,
} from '@/lib/business/types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRequestId(): string {
  return `biz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: BusinessRequestOptions['query']
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function parseErrorMessage(bodyText: string, status: number): string {
  if (!bodyText.trim()) return `HTTP ${status}`;
  try {
    const json = JSON.parse(bodyText) as {
      error?: string | { message?: string; code?: string };
      message?: string;
    };
    if (typeof json.error === 'string') return json.error;
    if (json.error && typeof json.error === 'object' && json.error.message) {
      return json.error.message;
    }
    if (typeof json.message === 'string') return json.message;
  } catch {
    /* use truncated raw text */
  }
  return bodyText.slice(0, 200);
}

function parseSuccessData<T>(bodyText: string, status: number, requestId: string): T {
  if (!bodyText.trim()) {
    // 204 / empty success
    return undefined as T;
  }
  try {
    const json = JSON.parse(bodyText) as unknown;
    // Support either raw payload or { data: ... } / { success, data }
    if (
      json &&
      typeof json === 'object' &&
      'data' in json &&
      (json as { data: unknown }).data !== undefined
    ) {
      return (json as { data: T }).data;
    }
    return json as T;
  } catch {
    throw new UnexpectedApiError('Invalid JSON response from Business API', {
      status,
      requestId,
    });
  }
}

async function defaultFetch(args: {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}): Promise<{ status: number; bodyText: string }> {
  try {
    const res = await fetch(args.url, {
      method: args.method,
      headers: args.headers,
      body: args.body,
      signal: args.signal,
    });
    const bodyText = await res.text();
    return { status: res.status, bodyText };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new NetworkError(
      error instanceof Error ? error.message : 'Network failure',
      { cause: error }
    );
  }
}

export type BusinessApiClient = {
  getConfig: () => BusinessApiConfig;
  request: <T>(options: BusinessRequestOptions) => Promise<ApiResponse<T>>;
  get: <T>(
    path: string,
    options?: Omit<BusinessRequestOptions, 'path' | 'method' | 'body'>
  ) => Promise<ApiResponse<T>>;
  post: <T>(
    path: string,
    body?: unknown,
    options?: Omit<BusinessRequestOptions, 'path' | 'method' | 'body'>
  ) => Promise<ApiResponse<T>>;
  put: <T>(
    path: string,
    body?: unknown,
    options?: Omit<BusinessRequestOptions, 'path' | 'method' | 'body'>
  ) => Promise<ApiResponse<T>>;
  patch: <T>(
    path: string,
    body?: unknown,
    options?: Omit<BusinessRequestOptions, 'path' | 'method' | 'body'>
  ) => Promise<ApiResponse<T>>;
  delete: <T>(
    path: string,
    options?: Omit<BusinessRequestOptions, 'path' | 'method' | 'body'>
  ) => Promise<ApiResponse<T>>;
};

let singleton: BusinessApiClient | null = null;
let singletonKey: string | null = null;

function configCacheKey(cfg: BusinessApiConfig): string {
  return `${cfg.baseUrl}|${cfg.timeoutMs}|${cfg.maxRetries}|${cfg.apiKey.length}`;
}

/**
 * Create Business API Client.
 * Business Tools must use this client — never call fetch() directly.
 */
export function createBusinessApiClient(deps?: {
  config?: BusinessApiConfig;
  auth?: AuthProvider;
  fetchImpl?: BusinessFetchImpl;
  forceNew?: boolean;
}): BusinessApiClient {
  const config = deps?.config ?? loadBusinessApiConfig();
  const key = configCacheKey(config);
  if (
    !deps?.forceNew &&
    singleton &&
    singletonKey === key &&
    !deps?.fetchImpl &&
    !deps?.auth
  ) {
    return singleton;
  }

  const auth = deps?.auth ?? createBearerTokenProvider(config.apiKey);
  const fetchImpl = deps?.fetchImpl ?? defaultFetch;

  async function requestOnce<T>(
    options: BusinessRequestOptions,
    requestId: string,
    attempt: number
  ): Promise<ApiResponse<T>> {
    const method: HttpMethod = options.method ?? 'GET';
    const url = buildUrl(config.baseUrl, options.path, options.query);
    // Endpoint path only for logs (no query secrets assumed in path)
    const endpoint = options.path.startsWith('/')
      ? options.path
      : `/${options.path}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Request-Id': requestId,
      ...(options.headers ?? {}),
    };
    await auth.apply(headers);

    let body: string | undefined;
    if (options.body !== undefined && method !== 'GET' && method !== 'DELETE') {
      body = JSON.stringify(options.body);
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const controller = new AbortController();
    const parent = options.signal;
    const onParentAbort = () => controller.abort();
    if (parent?.aborted) {
      controller.abort();
    } else if (parent) {
      parent.addEventListener('abort', onParentAbort);
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, config.timeoutMs);

    const started = Date.now();
    logBusinessApi(config.logging, 'info', 'request started', {
      requestId,
      method,
      endpoint,
      attempt,
    });

    try {
      const { status, bodyText } = await fetchImpl({
        url,
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const durationMs = Date.now() - started;

      if (status >= 400) {
        const message = parseErrorMessage(bodyText, status);
        const err = mapHttpStatusToError(status, message, requestId);
        logBusinessApi(config.logging, 'error', 'request failed', {
          requestId,
          method,
          endpoint,
          status,
          durationMs,
          errorCode: err.code,
          attempt,
        });
        throw err;
      }

      const data = parseSuccessData<T>(bodyText, status, requestId);
      logBusinessApi(config.logging, 'info', 'response received', {
        requestId,
        method,
        endpoint,
        status,
        durationMs,
        attempt,
      });

      return {
        success: true,
        data,
        status,
        requestId,
      };
    } catch (error) {
      const durationMs = Date.now() - started;

      if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
        if (parent?.aborted && !timedOut) {
          const err = new BusinessApiError('Request aborted', 'unexpected', {
            requestId,
            retryable: false,
          });
          logBusinessApi(config.logging, 'error', 'request failed', {
            requestId,
            method,
            endpoint,
            durationMs,
            errorCode: err.code,
            attempt,
          });
          throw err;
        }
        const err = new TimeoutError('Business API request timed out', {
          requestId,
        });
        logBusinessApi(config.logging, 'error', 'request failed', {
          requestId,
          method,
          endpoint,
          durationMs,
          errorCode: err.code,
          attempt,
        });
        throw err;
      }

      if (error instanceof BusinessApiError) {
        throw error;
      }

      const err = new NetworkError(
        error instanceof Error ? error.message : 'Network failure',
        { requestId, cause: error }
      );
      logBusinessApi(config.logging, 'error', 'request failed', {
        requestId,
        method,
        endpoint,
        durationMs,
        errorCode: err.code,
        attempt,
      });
      throw err;
    } finally {
      clearTimeout(timer);
      if (parent) {
        parent.removeEventListener('abort', onParentAbort);
      }
    }
  }

  async function request<T>(
    options: BusinessRequestOptions
  ): Promise<ApiResponse<T>> {
    const requestId = options.requestId?.trim() || createRequestId();
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= config.maxRetries) {
      try {
        return await requestOnce<T>(options, requestId, attempt);
      } catch (error) {
        lastError = error;
        if (
          !isRetryableBusinessError(error) ||
          attempt >= config.maxRetries
        ) {
          throw error;
        }
        const backoff = 250 * Math.pow(2, attempt);
        await sleep(backoff);
        attempt += 1;
      }
    }

    throw (
      lastError ||
      new UnexpectedApiError('Business API request failed', { requestId })
    );
  }

  const client: BusinessApiClient = {
    getConfig: () => config,
    request,
    get: (path, options) =>
      request({ ...options, path, method: 'GET' }),
    post: (path, body, options) =>
      request({ ...options, path, method: 'POST', body }),
    put: (path, body, options) =>
      request({ ...options, path, method: 'PUT', body }),
    patch: (path, body, options) =>
      request({ ...options, path, method: 'PATCH', body }),
    delete: (path, options) =>
      request({ ...options, path, method: 'DELETE' }),
  };

  if (!deps?.fetchImpl && !deps?.auth) {
    singleton = client;
    singletonKey = key;
  }

  return client;
}

/** Reset singleton (tests). */
export function resetBusinessApiClient(): void {
  singleton = null;
  singletonKey = null;
}

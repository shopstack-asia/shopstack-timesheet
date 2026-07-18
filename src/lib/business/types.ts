/**
 * Business API Client types (CS-Core / internal REST).
 * No domain business logic — transport contracts only.
 */

export type HttpMethod =
  | 'GET'
  | 'HEAD'
  | 'OPTIONS'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE';

/** Standardized success envelope returned by BusinessApiClient. */
export interface ApiResponse<T> {
  success: true;
  data: T;
  status: number;
  requestId: string;
}

/** Normalized error body (never includes secrets). */
export interface ApiError {
  code: string;
  message: string;
}

export type BusinessApiConfig = {
  baseUrl: string;
  timeoutMs: number;
  /** Secret used by the default Bearer auth provider — never log. */
  apiKey: string;
  /** Max retries after a retryable failure (default 2). Only for idempotent requests. */
  maxRetries: number;
  /** Structured request/response logging (no secrets). */
  logging: boolean;
};

export type BusinessRequestOptions = {
  path: string;
  method?: HttpMethod;
  /** JSON-serializable body (POST/PUT/PATCH) */
  body?: unknown;
  /** Query string params (undefined values omitted) */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Correlation id (generated if omitted) */
  requestId?: string;
  /** Cooperative cancellation from Tool Executor / caller */
  signal?: AbortSignal;
  /** Override Content-Type (default application/json when body present) */
  headers?: Record<string, string>;
  /**
   * When true, client may retry timeout/network/429/503/504.
   * Defaults: GET/HEAD/OPTIONS → true; POST/PATCH → false; PUT/DELETE → false (tool must opt in).
   */
  idempotent?: boolean;
  /**
   * When set, sent as `Idempotency-Key` for create/update safety on the server.
   * Never treated as a secret in logs (opaque correlation key only).
   */
  idempotencyKey?: string;
};

export type BusinessFetchImpl = (args: {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}) => Promise<{ status: number; bodyText: string }>;

/**
 * Resolve whether a request may be automatically retried.
 * Explicit `idempotent` always wins; otherwise method defaults apply.
 */
export function resolveRequestIdempotent(
  method: HttpMethod,
  idempotent?: boolean
): boolean {
  if (typeof idempotent === 'boolean') return idempotent;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }
  // POST / PATCH default false; PUT / DELETE require explicit opt-in
  return false;
}

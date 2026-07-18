/**
 * Business API Client types (CS-Core / internal REST).
 * No domain business logic — transport contracts only.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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
  /** Max retries after a retryable failure (default 2). */
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
};

export type BusinessFetchImpl = (args: {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}) => Promise<{ status: number; bodyText: string }>;

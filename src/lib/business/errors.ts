import type { ApiError } from '@/lib/business/types';

export type BusinessApiErrorCode =
  | 'authentication'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'unexpected'
  | 'invalid_config'
  | 'missing_config';

/**
 * Base typed error for Business API Client.
 * Tools must catch these — never inspect raw HTTP status codes.
 */
export class BusinessApiError extends Error {
  readonly code: BusinessApiErrorCode;
  readonly status?: number;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly details?: ApiError;

  constructor(
    message: string,
    code: BusinessApiErrorCode,
    options?: {
      status?: number;
      requestId?: string;
      retryable?: boolean;
      details?: ApiError;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = 'BusinessApiError';
    this.code = code;
    this.status = options?.status;
    this.requestId = options?.requestId;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export class AuthenticationError extends BusinessApiError {
  constructor(message = 'Authentication failed', opts?: { requestId?: string; status?: number }) {
    super(message, 'authentication', {
      status: opts?.status ?? 401,
      requestId: opts?.requestId,
      retryable: false,
    });
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends BusinessApiError {
  constructor(message = 'Validation failed', opts?: { requestId?: string; status?: number }) {
    super(message, 'validation', {
      status: opts?.status ?? 400,
      requestId: opts?.requestId,
      retryable: false,
    });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends BusinessApiError {
  constructor(message = 'Resource not found', opts?: { requestId?: string; status?: number }) {
    super(message, 'not_found', {
      status: opts?.status ?? 404,
      requestId: opts?.requestId,
      retryable: false,
    });
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends BusinessApiError {
  constructor(message = 'Conflict', opts?: { requestId?: string; status?: number }) {
    super(message, 'conflict', {
      status: opts?.status ?? 409,
      requestId: opts?.requestId,
      retryable: false,
    });
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends BusinessApiError {
  constructor(message = 'Rate limited', opts?: { requestId?: string; status?: number }) {
    super(message, 'rate_limit', {
      status: opts?.status ?? 429,
      requestId: opts?.requestId,
      retryable: true,
    });
    this.name = 'RateLimitError';
  }
}

export class TimeoutError extends BusinessApiError {
  constructor(message = 'Request timed out', opts?: { requestId?: string }) {
    super(message, 'timeout', {
      requestId: opts?.requestId,
      retryable: true,
    });
    this.name = 'TimeoutError';
  }
}

export class NetworkError extends BusinessApiError {
  constructor(message = 'Network failure', opts?: { requestId?: string; cause?: unknown }) {
    super(message, 'network', {
      requestId: opts?.requestId,
      retryable: true,
      cause: opts?.cause,
    });
    this.name = 'NetworkError';
  }
}

export class UnexpectedApiError extends BusinessApiError {
  constructor(
    message = 'Unexpected API error',
    opts?: { requestId?: string; status?: number; retryable?: boolean }
  ) {
    super(message, 'unexpected', {
      status: opts?.status,
      requestId: opts?.requestId,
      retryable: opts?.retryable ?? false,
    });
    this.name = 'UnexpectedApiError';
  }
}

/** Map HTTP status to a typed BusinessApiError subclass. */
export function mapHttpStatusToError(
  status: number,
  message: string,
  requestId: string
): BusinessApiError {
  if (status === 401 || status === 403) {
    return new AuthenticationError(message || 'Authentication failed', {
      status,
      requestId,
    });
  }
  if (status === 400 || status === 422) {
    return new ValidationError(message || 'Validation failed', { status, requestId });
  }
  if (status === 404) {
    return new NotFoundError(message || 'Resource not found', { status, requestId });
  }
  if (status === 409) {
    return new ConflictError(message || 'Conflict', { status, requestId });
  }
  if (status === 429) {
    return new RateLimitError(message || 'Rate limited', { status, requestId });
  }
  if (status === 503 || status === 504) {
    return new UnexpectedApiError(message || `Upstream HTTP ${status}`, {
      status,
      requestId,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new UnexpectedApiError(message || `Upstream HTTP ${status}`, {
      status,
      requestId,
      retryable: false,
    });
  }
  return new UnexpectedApiError(message || `Upstream HTTP ${status}`, {
    status,
    requestId,
    retryable: false,
  });
}

export function isRetryableBusinessError(error: unknown): boolean {
  return error instanceof BusinessApiError && error.retryable;
}

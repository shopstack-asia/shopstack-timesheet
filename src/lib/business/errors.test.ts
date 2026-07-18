import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  BusinessApiError,
  ConflictError,
  isRetryableBusinessError,
  mapHttpStatusToError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
  UnexpectedApiError,
  ValidationError,
} from '@/lib/business/errors';

describe('BusinessApiError hierarchy', () => {
  it('creates typed subclasses with expected codes', () => {
    expect(new AuthenticationError().code).toBe('authentication');
    expect(new ValidationError().code).toBe('validation');
    expect(new NotFoundError().code).toBe('not_found');
    expect(new ConflictError().code).toBe('conflict');
    expect(new RateLimitError().code).toBe('rate_limit');
    expect(new TimeoutError().code).toBe('timeout');
    expect(new NetworkError().code).toBe('network');
    expect(new UnexpectedApiError().code).toBe('unexpected');
  });

  it('marks retryable errors', () => {
    expect(isRetryableBusinessError(new RateLimitError())).toBe(true);
    expect(isRetryableBusinessError(new TimeoutError())).toBe(true);
    expect(isRetryableBusinessError(new NetworkError())).toBe(true);
    expect(isRetryableBusinessError(new AuthenticationError())).toBe(false);
    expect(isRetryableBusinessError(new ValidationError())).toBe(false);
    expect(isRetryableBusinessError(new NotFoundError())).toBe(false);
    expect(isRetryableBusinessError(new ConflictError())).toBe(false);
    expect(isRetryableBusinessError(new Error('x'))).toBe(false);
  });
});

describe('mapHttpStatusToError', () => {
  it('maps auth statuses', () => {
    expect(mapHttpStatusToError(401, 'nope', 'r1')).toBeInstanceOf(
      AuthenticationError
    );
    expect(mapHttpStatusToError(403, 'nope', 'r1')).toBeInstanceOf(
      AuthenticationError
    );
  });

  it('maps validation statuses', () => {
    expect(mapHttpStatusToError(400, 'bad', 'r1')).toBeInstanceOf(
      ValidationError
    );
    expect(mapHttpStatusToError(422, 'bad', 'r1')).toBeInstanceOf(
      ValidationError
    );
  });

  it('maps not found and conflict', () => {
    expect(mapHttpStatusToError(404, 'miss', 'r1')).toBeInstanceOf(
      NotFoundError
    );
    expect(mapHttpStatusToError(409, 'dup', 'r1')).toBeInstanceOf(
      ConflictError
    );
  });

  it('maps rate limit and retryable gateway errors', () => {
    const rate = mapHttpStatusToError(429, 'slow', 'r1');
    expect(rate).toBeInstanceOf(RateLimitError);
    expect(rate.retryable).toBe(true);

    const s503 = mapHttpStatusToError(503, 'down', 'r1');
    expect(s503.retryable).toBe(true);
    const s504 = mapHttpStatusToError(504, 'gw', 'r1');
    expect(s504.retryable).toBe(true);
  });

  it('maps other 5xx as non-retryable unexpected by default', () => {
    const err = mapHttpStatusToError(500, 'boom', 'r1');
    expect(err).toBeInstanceOf(UnexpectedApiError);
    expect(err.retryable).toBe(false);
  });

  it('base BusinessApiError carries requestId', () => {
    const err = new BusinessApiError('x', 'unexpected', { requestId: 'abc' });
    expect(err.requestId).toBe('abc');
  });
});

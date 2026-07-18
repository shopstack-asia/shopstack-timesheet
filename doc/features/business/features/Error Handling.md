# Error Handling

## Rule

Business Tools must catch **typed errors** from `@/lib/business`. They must **never** inspect raw HTTP status codes.

## Error types

| Class | Code | Typical HTTP | Retryable |
|-------|------|--------------|-----------|
| `AuthenticationError` | `authentication` | 401, 403 | no |
| `ValidationError` | `validation` | 400, 422 | no |
| `NotFoundError` | `not_found` | 404 | no |
| `ConflictError` | `conflict` | 409 | no |
| `RateLimitError` | `rate_limit` | 429 | transport-retryable* |
| `TimeoutError` | `timeout` | — | transport-retryable* |
| `NetworkError` | `network` | — | transport-retryable* |
| `UnexpectedApiError` | `unexpected` | 5xx / other | 503/504 transport-retryable*; else no |

\* **Transport-retryable** errors are retried by the client **only when** the request is idempotent (`idempotent === true` after defaults). Non-idempotent POST/PATCH (and default PUT/DELETE) return immediately even on 429/timeout.

## ApiError body shape

```ts
interface ApiError {
  code: string;
  message: string;
}
```

## Mapping

`mapHttpStatusToError(status, message, requestId)` centralizes mapping inside the client.

`shouldRetryBusinessRequest(idempotent, error, attempt, maxRetries)` gates retries — HTTP status alone is never enough.

## Source Code References

- `src/lib/business/errors.ts`
- `src/lib/business/client.ts`

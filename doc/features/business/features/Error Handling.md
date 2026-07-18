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
| `RateLimitError` | `rate_limit` | 429 | yes |
| `TimeoutError` | `timeout` | — | yes |
| `NetworkError` | `network` | — | yes |
| `UnexpectedApiError` | `unexpected` | 5xx / other | 503/504 yes; else no |

All extend `BusinessApiError` with optional `status`, `requestId`, `details`.

## ApiError body shape

```ts
interface ApiError {
  code: string;
  message: string;
}
```

## Mapping

`mapHttpStatusToError(status, message, requestId)` centralizes mapping inside the client.

## Source Code References

- `src/lib/business/errors.ts`
- `src/lib/business/client.ts`

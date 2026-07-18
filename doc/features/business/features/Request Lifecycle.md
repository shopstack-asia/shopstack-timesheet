# Request Lifecycle

## Sequence

```mermaid
sequenceDiagram
  participant T as Tool
  participant C as Client
  participant API as REST

  T->>C: request(path, requestId, signal, idempotent?)
  C->>C: resolve idempotent + auth + timeout AbortController
  Note over C: log request started (method, idempotent, retryAttempt)
  C->>API: HTTP (+ Idempotency-Key when set)
  alt success
    API-->>C: 2xx body
    Note over C: log response received
    C-->>T: ApiResponse data
  else idempotent AND retryable failure
    Note over C: timeout / network / 429 / 503 / 504
    C->>C: backoff + retry (maxRetries)
  else non-idempotent OR non-retryable
    Note over C: POST/PATCH defaults; 400/401/403/404/409/422/...
    C-->>T: typed BusinessApiError (no automatic retry)
  end
```

## Options on every request

| Field | Purpose |
|-------|---------|
| `requestId` | Correlation (auto-generated if omitted) |
| `signal` | Cooperative cancel from Tool Executor |
| `idempotent` | Opt into/out of automatic retries |
| `idempotencyKey` | Sent as `Idempotency-Key` header when set |

## Idempotent defaults

| Method | Default `idempotent` |
|--------|----------------------|
| GET, HEAD, OPTIONS | `true` |
| POST, PATCH | `false` |
| PUT, DELETE | `false` (Business Tool must set `idempotent: true` when safe) |

Explicit `idempotent` always overrides the method default.

## Timeout

Per-request `AbortController` with `BUSINESS_API_TIMEOUT_MS`. Timeout aborts the in-flight fetch and maps to `TimeoutError`. Timeout is **not** retried unless the request is idempotent.

## Retry policy

Retry **only when all** are true:

1. `resolveRequestIdempotent(method, options.idempotent) === true`
2. Error is timeout, network, HTTP 429, 503, or 504
3. `attempt < maxRetries`

Never retry based on HTTP status alone. Unsafe `POST /timesheets` timeouts return immediately (no duplicate create).

Backoff: `250 * 2^attempt` ms.

## Idempotency-Key

When `idempotencyKey` is supplied, the client sets:

```http
Idempotency-Key: <value>
```

Future create/update Timesheet tools should pass a stable key so the server can dedupe even if a client later opts into safe retries.

## Logging

```text
request started → response received
              ↘ request failed
```

Fields: `requestId`, `method`, `endpoint`, `status`, `duration`, `idempotent`, `retryAttempt`, `idempotencyKey`. Never Authorization / API keys / tokens.

## Response shape

```ts
interface ApiResponse<T> {
  success: true;
  data: T;
  status: number;
  requestId: string;
}
```

Supports raw JSON payloads or `{ data: T }` envelopes.

## Source Code References

- `src/lib/business/client.ts`
- `src/lib/business/types.ts` — `resolveRequestIdempotent`
- `src/lib/business/logger.ts`

# Business — feature logic summary

| Doc | Description |
|-----|-------------|
| [Business API Foundation.md](./features/Business%20API%20Foundation.md) | Architecture and module map |
| [Authentication.md](./features/Authentication.md) | Auth providers and header rules |
| [Request Lifecycle.md](./features/Request%20Lifecycle.md) | Timeout, abort, retry, logging |
| [Error Handling.md](./features/Error%20Handling.md) | Typed error mapping |

## Related code

- `src/lib/business/config.ts`
- `src/lib/business/auth.ts`
- `src/lib/business/client.ts`
- `src/lib/business/errors.ts`
- `src/lib/business/logger.ts`
- `src/instrumentation.ts` — startup validation

# Business — domain features

| Capability | Summary |
|------------|---------|
| Config | `BUSINESS_API_*` env; startup validation when configured |
| Auth | Bearer (current), API Key provider, OAuth/JWT stubs |
| HTTP Client | GET/POST/PUT/PATCH/DELETE via single client |
| Retry | Idempotent requests only: timeout, network, 429, 503, 504 |
| Errors | Typed errors — tools never inspect HTTP codes |
| Logging | started / received / failed; secrets redacted |

## Constraints

- Business Tools must **never** call `fetch()` directly
- Never log Authorization / API keys / tokens
- No business domain endpoints implemented in this phase (foundation only)

# Auth — feature logic summary

| Doc | Description |
|-----|-------------|
| [google-sso-domain-and-zoho-gate.md](./features/google-sso-domain-and-zoho-gate.md) | Google SSO, domain allowlist, Zoho attach, JWT session, auth pages |
| [google-oauth-and-zoho-credentials-setup.md](./features/google-oauth-and-zoho-credentials-setup.md) | Operator setup: Google OAuth, Zoho Forms scope, refresh token |

## Related code

- `src/lib/auth.ts`
- `src/app/api/auth/[...nextauth]/route.ts`
- `src/app/auth/signin/page.tsx`
- `src/app/auth/error/page.tsx`

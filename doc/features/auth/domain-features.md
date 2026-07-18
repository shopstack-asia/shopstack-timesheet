# Auth — domain features

## Capabilities

1. **Google OAuth sign-in** via NextAuth Google provider.
2. **Domain gate** — email must end with `@shopstack.asia`.
3. **Zoho employee gate** — must resolve a Zoho People employee by email; otherwise deny (fail closed, including Zoho errors).
4. **Session enrichment** — `staffProfile` stored on JWT and exposed on `session.staffProfile`.
5. **Custom auth pages** — `/auth/signin`, `/auth/error` with AccessDenied messaging for domain/Zoho failures.
6. **JWT session strategy** (not database sessions).

## Dependencies

- Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, Zoho credentials
- `src/lib/zoho-people.ts` → `getEmployeeByEmail`

## Non-obvious constraints

- Sign-in denies when Zoho throws — not only when employee is missing.
- Middleware (layout area) protects timesheet UI/APIs; `/api/auth/*` is not in the matcher (NextAuth handles it).
- UI primarily uses `useSession().staffProfile`; `/api/staff/profile` exists but is unused by current UI.

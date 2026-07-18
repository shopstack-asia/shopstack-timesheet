# Google SSO, domain gate, and Zoho staff profile

### Overview

Employees authenticate with Google. Only `@shopstack.asia` accounts that exist in Zoho People receive a JWT session containing `staffProfile`.

### Business Purpose

Restrict the app to Shopstack staff and bind each session to authoritative employee fields (EmployeeID, name, position, location) used when writing time logs and loading leave/holidays.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Unauthenticated | `/auth/signin`, `/auth/error`, `/api/auth/*` | Start Google sign-in |
| `@shopstack.asia` + Zoho employee | Full app (via middleware) | Use timesheet |
| Wrong domain or missing Zoho employee | Denied | See AccessDenied / error page |

### Workflow

1. User opens `/` → redirected to sign-in or timesheet (see layout).
2. Sign-in page calls Google via NextAuth (`callbackUrl` `/timesheet`).
3. `signIn` callback: require email → require `@shopstack.asia` → Zoho `getEmployeeByEmail` → attach `user.staffProfile` or return `false`.
4. `jwt` callback copies `staffProfile` onto the token; `session` callback exposes it on `session.staffProfile`.
5. Failures surface as NextAuth `AccessDenied` / custom error page copy.

### Use Cases

- Successful login
- Denied: wrong email domain
- Denied: not in Zoho / Zoho API error
- Sign out (timesheet shell → `/auth/signin`)

### Screen Behavior

- **Sign-in** (`src/app/auth/signin/page.tsx`): Google button; Suspense; AccessDenied messaging for domain.
- **Error** (`src/app/auth/error/page.tsx`): Maps `AccessDenied`, `Configuration`, `Verification`; AccessDenied lists domain / Zoho missing / token issues.

### Business Logic

- Domain check: `email.endsWith('@shopstack.asia')`.
- Zoho miss or throw → deny sign-in (fail closed).
- Session strategy: `jwt`.

### Validation Rules

- Email required on Google profile.
- Domain suffix enforced before Zoho call.

### Edge Cases

- No email on profile → deny + log.
- Zoho timeout/error → deny + log stack in server logs.

### API and Integration Behavior

- `GET/POST /api/auth/[...nextauth]` — NextAuth handlers using `authOptions`.
- Upstream: Google OAuth + Zoho People (server-only).

### Data Model Summary

```ts
StaffProfile {
  EmployeeID, FirstName, LastName, Nickname, Email, Position, Location?
}
```

Extended on NextAuth `User`, `Session`, and `JWT`.

### Operation Notes

- OAuth redirect URI must include `/api/auth/callback/google`.
- Credential setup (Google + Zoho scopes/token): [google-oauth-and-zoho-credentials-setup.md](./google-oauth-and-zoho-credentials-setup.md)
- Env catalog: [ops/environment-variables.md](../../ops/features/environment-variables.md)

### Known Limitations

- Single allowed domain hardcoded (`@shopstack.asia`).
- No refresh of Zoho profile mid-session (profile frozen at login until re-login).

### Source Code References

- `src/lib/auth.ts`
- `src/app/api/auth/[...nextauth]/route.ts`
- `src/app/auth/signin/page.tsx`
- `src/app/auth/error/page.tsx`

### Required tests

- Deny non-`@shopstack.asia` email
- Deny when Zoho returns null
- Deny when Zoho throws
- Allow when domain + Zoho profile succeed (mocked)
- Session includes `staffProfile` after jwt/session callbacks

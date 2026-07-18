# Auth — feature area

## Purpose

Google SSO (NextAuth), `@shopstack.asia` domain gate, Zoho People staff profile on the JWT session, and auth UI pages.

## Scope

- `src/lib/auth.ts`
- `src/app/api/auth/[...nextauth]/route.ts`
- `src/app/auth/signin/`, `src/app/auth/error/`
- Session type extensions for `staffProfile`
- Related: middleware matchers documented under **layout**

## Reading order

1. This README
2. [domain-features.md](./domain-features.md)
3. [feature-logic-summary.md](./feature-logic-summary.md)
4. [features/](./features/)
5. Code

## Related areas

- `layout` — middleware protection, root redirect
- `staff` — EmployeeID from session used for leave
- `holidays` — Location from session used for holiday cache key

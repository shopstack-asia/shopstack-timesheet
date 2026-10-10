# Workspace — feature area

## Purpose

ShopStack Workspace is the shared shell for internal business modules. Timesheet and Expense are modules inside that shell.

## Scope

- Application branding (`ShopStack Workspace`)
- Shared layout: header, navigation, theme, profile, sign-out
- Central navigation and role checks
- Settings → Roles & Permission, stored in the expense PostgreSQL database
- Authenticated routes `/dashboard`, `/timesheet`, `/expense/*`, `/settings/*`
- Route compatibility: `/` still opens My Timesheet after sign-in

## Out of scope

- Timesheet entry rules, Sheets writes, Slack, and the AI agent
- Expense approval rules and Timesheet storage

## Reading order

1. This README
2. [domain-features.md](./domain-features.md)
3. [feature-logic-summary.md](./feature-logic-summary.md)
4. [features/](./features/)
5. Code

## Related areas

- `layout` — root redirect, middleware, theme
- `auth` — Google SSO and Zoho staff profile
- `expense` — expense module
- `timesheet` — existing weekly timesheet

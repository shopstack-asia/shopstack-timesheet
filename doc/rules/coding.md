# Coding standards — shopstack-timesheet

## 1. Core principle

**Consistency over cleverness.** Match existing patterns in the same feature area and layer. If two patterns exist, prefer the one used in the files you are touching unless the task explicitly migrates style.

## 2. Architecture rules

| Layer | Location | Responsibility |
|--------|-----------|----------------|
| **Pages** | `src/app/` | Routing and composition (`/`, `/timesheet`, `/auth/*`). |
| **Components** | `src/components/` | Presentation and local UI state. **No** direct Zoho/Sheets/Slack/SMTP calls. Call **`/api/*` only**. |
| **API routes** | `src/app/api/` | Auth-gated handlers, cron jobs, debug probes; validate input; return `ApiResponse<T>`. |
| **Lib** | `src/lib/` | Server-only integrations and helpers (`auth`, `google-sheets`, `zoho-people`, `redis`, cache, leave/holiday utils). |
| **Contexts** | `src/contexts/` | Global client state (e.g. `ThemeContext`). |
| **Types** | `src/types/` | Shared domain and API types. |
| **Middleware** | `src/middleware.ts` | NextAuth protection for `/timesheet` and selected `/api/*` paths. |

## 3. Component rules

- Prefer existing timesheet UI patterns (`WeeklyTimesheet`, `DailyCard`, `TimeEntryForm`, `SearchableSelect`).
- Add **`'use client'`** only when required (hooks, event handlers, browser APIs).
- Co-locate UI-only helpers with the component; move shared pure logic to `src/lib/`.

## 4. API route rules

- Every **external** integration MUST go through a Route Handler and/or server-only `src/lib/*`.
- Prefer: `getServerSession(authOptions)`, Zod `safeParse`, `ApiResponse<T>` success/error shapes.
- Cron routes: require `Authorization: Bearer ${CRON_SECRET}` (or the existing pattern in that route).
- Never return raw upstream stack traces or secrets to the client.
- Document request/response changes in the owning `doc/features/<feature-area>/`.

## 5. State management rules

- Global UI state uses React Context in `src/contexts/` when needed.
- Prefer refetch via `/api/*` over inventing parallel client stores for server data.

## 6. Naming conventions

| Kind | Convention |
|------|---------------|
| Variables and functions | `camelCase` |
| React components | `PascalCase` |
| File and folder names (new) | Match adjacent files (`route.ts`, `PascalCase.tsx` for components) |
| True constants | `SCREAMING_SNAKE_CASE` |

## 7. Copy / i18n

- This app does **not** use Hertz-style `useLanguage()` / CMS translate.
- Keep UI copy consistent with existing English strings in components; do not invent a new i18n system unless the task explicitly requires it.

## 8. Reuse rules

- Search for existing hooks, lib helpers, and types before adding parallel implementations.
- Align import paths with the `@/` alias.

## 9. Forbidden patterns

- Business rules only in layout with no API/lib ownership.
- External API calls from `'use client'` modules against non-`/api/*` URLs.
- Secrets in client bundles (`NEXT_PUBLIC_*` only for non-secret config already used, e.g. holiday location defaults).
- Over-engineered abstractions not already present in the codebase.

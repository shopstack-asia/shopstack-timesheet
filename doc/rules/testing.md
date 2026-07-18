# Testing standards — shopstack-timesheet

## 0. Test runner status

Unit tests use **Vitest**.

```bash
npm test          # vitest run (CI / completion)
npm run test:watch
```

Config: `vitest.config.ts` (Node environment, `src/**/*.test.ts`, `@/` path alias).

## 1. Mandatory rules

- **Every implementation** MUST update **documentation** when behavior changes — see [implementation_completion.md](./implementation_completion.md).
- **Every meaningful change** to logic should be designed so it can be unit-tested (pure functions, clear inputs/outputs).
- **Every meaningful change** MUST include new or updated tests when a runner exists (it does).

## 2. Test scope

| Area | What to test |
|------|----------------|
| **API route handlers** | Happy path, auth guard, validation failures, upstream failure mapping, status codes. |
| **Utility functions** | Branches, boundaries, stable outputs (`leave-utils`, time-log ID generation, date helpers, write lock, sequential submit). |
| **Lib integrations** | Prefer testing wrappers/mappers with mocked upstream clients. |
| **Components** | Complex interactions only (multi-entry day, leave/holiday blocking)—skip trivial presentational snapshots. |

## 3. Required test cases

For each meaningful unit of behavior, include where applicable:

- **Happy path**
- **Error path** (validation, unauthorized, upstream errors)
- **Edge cases** (empty lists, half-day leave, custom project names, boundary hours)

## 4. Test quality rules

- Assert **observable behavior**, not private implementation details.
- Name tests as behavior: `it('returns 401 when session is missing', ...)`.
- Avoid flaky timing; mock clocks / injectable `sleep` for lock and date-sensitive logic.

## 5. Output and reporting requirement

Task reports must list:

- **Test files** added or changed (or “none”).
- **What behavior** each new test covers (or why tests were not added).
- **Test command** executed and result.

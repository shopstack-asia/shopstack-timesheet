# Testing standards — shopstack-timesheet

## 0. Test runner status

There is **no** `npm test` / Jest / Vitest script in `package.json` today.

Until a runner is added:

- Extract meaningful pure logic into `src/lib/` (or sibling modules next to routes).
- Document expected behaviors under **Required tests** in feature docs.
- Do **not** claim unit-test coverage that was not executed.

When a runner is introduced, add tests in the **same** effort and update this file with the real commands.

## 1. Mandatory rules

- **Every implementation** MUST update **documentation** when behavior changes — see [implementation_completion.md](./implementation_completion.md).
- **Every meaningful change** to logic should be designed so it can be unit-tested (pure functions, clear inputs/outputs).
- When a test runner exists, **every meaningful change** MUST include new or updated tests.

## 2. Test scope (when a runner exists)

| Area | What to test |
|------|----------------|
| **API route handlers** | Happy path, auth guard, validation failures, upstream failure mapping, status codes. |
| **Utility functions** | Branches, boundaries, stable outputs (`leave-utils`, time-log ID generation, date helpers). |
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
- Avoid flaky timing; mock clocks for date-sensitive logic.

## 5. Output and reporting requirement

Task reports must list:

- **Test files** added or changed (or “none”).
- **What behavior** each new test covers (or why tests were not added).
- **Test command** executed and result — or explicit note that no runner is configured.

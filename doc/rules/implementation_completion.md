# Implementation completion gate — shopstack-timesheet

## 1. Purpose

Every **implementation task** is incomplete until **documentation** and **quality checks** are updated in the same effort as the code. This file is the mandatory completion checklist for humans and AI agents.

## 2. What counts as “implementation”

Applies when you change any of:

- Business logic, validation, or state transitions
- API contracts (`src/app/api/*` request/response, status codes, error shapes)
- User flows, defaults, or error handling visible to users
- Shared utilities or lib helpers with non-trivial branches

**Exempt:** pure formatting, comment-only edits, or dependency bumps with **no** behavior change — still run lint/tsc if types may break.

**Docs-only tasks:** no production code touched → tests not required; update docs only.

## 3. Documentation — mandatory on every implementation

Before marking a task complete:

1. Identify the **feature area** (`doc/features/<feature-area>/`).
2. Update docs when behavior or contracts change — see [documentation.md](./documentation.md).
3. Minimum updates (as applicable):
   - Detailed behavior under `doc/features/<feature-area>/features/*.md`
   - Index in `doc/features/<feature-area>/feature-logic-summary.md`
   - Overview in `domain-features.md` when scope or responsibility changes
4. Each detailed feature doc SHOULD include a **Required tests** section listing behaviors that must stay covered.
5. If env vars or integration setup change, update the owning feature docs (e.g. `doc/features/ops/features/environment-variables.md`, auth/Sheets/reminders setup docs), `.env.example`, and root `README.md` as needed.

**Forbidden:** shipping behavior changes with outdated or missing feature-area docs.

## 4. Tests — mandatory when applicable

1. Follow [testing.md](./testing.md).
2. **Today:** no `npm test` script — extract testable helpers and document Required tests; do not invent a fake pass.
3. **When a runner exists:** cover happy path, error path, and edge cases; run the test command; fix new failures.

## 5. Completion checklist (all must be true)

- [ ] Code scoped to the task; follows [coding.md](./coding.md) and BFF/server boundary rules
- [ ] Feature-area **docs** updated (or “none — no behavior change” stated with reason)
- [ ] Root setup docs updated if env/integration setup changed
- [ ] Tests handled per [testing.md](./testing.md)
- [ ] `npx tsc --noEmit` and `npm run lint` run — new issues fixed
- [ ] Final report lists: files changed, logic summary, **doc paths**, test note, command results

## 6. Task is NOT complete if

- Behavior or API contracts changed but feature docs were not updated
- New TypeScript or ESLint failures were introduced and left unfixed
- Final report omits doc paths or tsc/lint results

## 7. Related rules

| File | Role |
|------|------|
| [documentation.md](./documentation.md) | Where and how to write feature docs |
| [testing.md](./testing.md) | Test scope and reporting |
| [ai-agent-instruction.md](../ai-agent-instruction.md) | Full agent workflow and report format |
| `.cursor/rules/implementation-completion.mdc` | Always-on Cursor reminder |

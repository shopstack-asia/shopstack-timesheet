# AI agent instruction — shopstack-timesheet

## 1. Title and purpose

This file is the **mandatory entry point** for any AI agent working in this repository. It defines the workflow, non-negotiable rules, and completion criteria so work is **scoped**, **document-aligned**, and **verifiable**.

## 2. Critical rule

Before **any** implementation (code, tests, or contract changes), the agent MUST:

1. Read **this file** in full.
2. Read **every mandatory rule file** listed in section 3.
3. Follow the workflow in section 4.

Skipping these steps is not allowed.

For the stakeholder checklist, see [doc/README.md — Team implementation principles](./README.md#team-implementation-principles).

Also respect always-on Cursor rules: `.cursor/rules/ai-agent.mdc` and `.cursor/rules/implementation-completion.mdc` (they require reading this `doc/` tree).

## 3. Mandatory rule files

Read all of the following under `doc/rules/` before writing code:

| File | Topic |
|------|--------|
| [rules/coding.md](./rules/coding.md) | Architecture, BFF, components, lib, naming |
| [rules/testing.md](./rules/testing.md) | Test scope, cases, quality, reporting |
| [rules/lint.md](./rules/lint.md) | TypeScript and ESLint gates |
| [rules/documentation.md](./rules/documentation.md) | Where docs live, when to update |
| [rules/implementation_completion.md](./rules/implementation_completion.md) | **Mandatory completion gate** |
| [rules/feature-area-documentation.md](./rules/feature-area-documentation.md) | Per-feature folder structure and naming |
| [rules/manual_documentation_template.md](./rules/manual_documentation_template.md) | Template for detailed `features/*.md` |

## 4. Mandatory workflow (step by step)

1. Read this file and **all** mandatory rule files in section 3.
2. **Identify the feature area** from the task and file paths (use [feature-logic-summary.md](./feature-logic-summary.md)).
3. Read **feature-area docs** in the order in section 5. If docs are missing, create the minimum set per [rules/feature-area-documentation.md](./rules/feature-area-documentation.md) before substantive code changes.
4. Inspect related **pages** (`src/app/`), **components** (`src/components/`), **API routes** (`src/app/api/`), **lib** (`src/lib/`), **contexts** (`src/contexts/`), and **types** (`src/types/`).
5. Follow **existing patterns** in the same feature area (Zod validation, `ApiResponse<T>`, `getServerSession(authOptions)`, Sheets/Zoho helpers).
6. Implement **only** scoped changes—no unrelated refactors.
7. Add or update tests for meaningful logic per [rules/testing.md](./rules/testing.md) (note: no test runner yet—design for testability).
8. Run **TypeScript**: `npx tsc --noEmit`.
9. Run **ESLint**: `npm run lint`.
10. **Fix** all failures **newly introduced** by your changes. For pre-existing failures, follow [rules/lint.md](./rules/lint.md).
11. If behavior, validation, flows, or API contracts changed, **update feature-area docs** under `doc/features/<feature-area>/` per [rules/documentation.md](./rules/documentation.md). Update env/setup feature docs and `.env.example` when configuration changes.
12. **Report** using the format in section 10.

## 5. Feature-area documentation resolution order

For the active `<feature-area>`:

1. `doc/features/<feature-area>/README.md`
2. `doc/features/<feature-area>/domain-features.md`
3. `doc/features/<feature-area>/feature-logic-summary.md`
4. `doc/features/<feature-area>/features/*.md` (detailed docs linked from the summary)

## 6. When detailed feature docs are required

Create or extend detailed files under `features/` when **any** of the following holds:

- Logic spans **multiple** files or layers (page + API + lib).
- More than **three** distinct branches, conditions, or outcomes.
- **Validation** rules or error codes matter for UX or support.
- **State transitions** (week load, leave/holiday blocking, submit replace).
- The change is **business-critical** (auth, time-log write, cron secrets).
- The agent would otherwise need to **infer** rules from scattered code.

## 7. Do-not rules

- Do not invent product or API behavior without docs or existing code proof.
- Do not call **external** HTTP APIs (Zoho, Sheets, Slack, SMTP) from client components.
- Do not put secrets or server-only tokens in client code.
- Do not weaken `@shopstack.asia` domain checks or cron `CRON_SECRET` auth without explicit task + doc updates.
- Do not import another feature area’s private internals across unclear boundaries.
- Do not complete the task with **new** TypeScript or ESLint failures unresolved.
- Do not leave feature docs **false** relative to shipped behavior.
- Do not apply Hertz/e-comm patterns (CMS, i18n `t()`, storefront SEO, PWA) as if they exist here.

## 8. Always rules

- Always identify the feature area and read its docs (or create the minimum doc set first).
- Always route **external** integration through **`src/app/api/*`** and/or server-only **`src/lib/*`**. Client calls stay on **`/api/*`**.
- Always reuse **existing types** in `src/types/` and helpers in `src/lib/`.
- Always run `npx tsc --noEmit` and `npm run lint` before claiming completion.
- Always update **feature-area documentation** when behavior or contracts change.
- Always report with the **final output format** below.

## 9. BFF / server enforcement

- **Client code must never call external backend URLs** for business operations.
- External integrations MUST live in **Next.js Route Handlers** under `src/app/api/` and/or modules under `src/lib/` used only from the server.
- API routes own: credentials, upstream calls, auth/session checks, **error mapping**, and **stable response shapes** (`ApiResponse<T>`).

## 10. Final output format

Every task report MUST include:

1. **Files changed** — list paths.
2. **Logic added or updated** — short, precise bullet points tied to behavior.
3. **Tests added or updated** — file paths and behaviors covered, or “none — no test runner / no meaningful pure logic”.
4. **TypeScript** — `npx tsc --noEmit` pass/fail.
5. **ESLint** — `npm run lint` pass/fail.
6. **Docs updated** — list `doc/features/...` or `doc/...` files touched, or “none” with reason.

## 11. Enforcement

A task is **complete** only when:

- Code matches scope and **BFF / boundary** rules.
- **Documentation** is updated when behavior or contracts changed (see [rules/implementation_completion.md](./rules/implementation_completion.md)).
- Quality gates in [rules/lint.md](./rules/lint.md) and testing expectations in [rules/testing.md](./rules/testing.md) are satisfied.
- The **final output format** has been provided.

**A task is NOT complete** if behavior changed without doc updates, or new tsc/lint failures were left unfixed.

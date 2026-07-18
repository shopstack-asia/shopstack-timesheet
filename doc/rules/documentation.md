# Documentation standards — shopstack-timesheet

## 1. Purpose

Documentation makes **business logic and API contracts discoverable** for developers and AI agents. It reduces wrong assumptions about Zoho People, Google Sheets, auth, and timesheet rules.

**Engineering standards** under `doc/rules/` (except this file and `manual_documentation_template.md`) and `doc/ai-agent-instruction.md` / `doc/prompt.md` are **not** feature manuals.

## 2. Where feature-area docs live

| Location | Content |
|----------|---------|
| `doc/features/<feature-area>/README.md` | Purpose, scope, reading order for that area. |
| `doc/features/<feature-area>/domain-features.md` | High-level overview of behaviors and responsibilities. |
| `doc/features/<feature-area>/feature-logic-summary.md` | Short index linking to detailed docs under `features/`. |
| `doc/features/<feature-area>/features/` | Detailed domain behavior docs (behavior-centric filenames). |
| `doc/rules/` | Shared standards only—no replacement for feature logic. |

Global navigation: [../feature-logic-summary.md](../feature-logic-summary.md).

Operator setup (env, OAuth, Sheets, cron) lives under the owning **`doc/features/<area>/features/`** docs (see `ops/environment-variables.md`). Root keeps `README.md` + `.env.example` only.

## 3. When documentation must be updated

Documentation updates are **mandatory on every implementation** that changes behavior — see [implementation_completion.md](./implementation_completion.md).

Update the relevant `doc/features/<feature-area>/` docs when:

- **Business logic** or decision rules change.
- **Validation** rules change.
- **User flows** or steps change (including error states).
- **API contracts** change: request shape, response shape, status codes, or error payload conventions.
- **Env vars / setup** change — update the owning feature setup docs (e.g. `ops/environment-variables.md`, auth credentials setup, master-data Sheets notes) and `.env.example` / root `README.md` as needed.

## 4. When to add feature docs

Add or extend detailed docs under `features/` when:

- Logic spans **multiple** files or layers.
- There are more than **three** meaningful branches or conditions.
- There is non-trivial **validation**.
- There are **state machines** or step-based flows (week load, submit replace, leave blocking).
- The behavior is **business-critical** (auth, time-log write, cron).

## 5. Feature file structure (manual-ready)

Each detailed behavior doc under `features/` MUST follow **[manual_documentation_template.md](./manual_documentation_template.md)**.

Also include **Required tests** describing behaviors that must stay covered when a test runner exists.

Base content on **latest source code**; mark behavior as **Not confirmed in code** rather than guessing.

## 6. Documentation style

- Concise, structured headings, bullet lists for rules.
- Explicit nouns, stable terminology, links to routes and files.
- Avoid duplicating code line-by-line; summarize **intent** and **invariants**.

## 7. API contract documentation

When a Route Handler’s request or response contract changes:

- Update the **feature area** that owns that endpoint.
- Include example payloads only when they clarify ambiguity.
- Note breaking vs backward-compatible changes when relevant.

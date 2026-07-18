# Feature-area documentation — shopstack-timesheet

## 1. Rule

For every **feature area** that receives **meaningful** behavioral or contract changes, documentation MUST be **created or maintained** under:

```text
doc/features/<feature-area>/
```

“Meaningful” includes logic, validation, user-visible flows, and API request/response shapes.

## 2. Required structure per feature area

| Path | Required |
|------|----------|
| `README.md` | Yes — purpose, scope, reading order for the folder. |
| `domain-features.md` | Yes — high-level behavior map for the area. |
| `feature-logic-summary.md` | Yes — index of links into `features/`. |
| `features/*.md` | As needed — one doc per **domain behavior** worth explaining. |

## 3. Purpose of each file

- **`README.md`** — What belongs in this area, how to read the rest, links to global rules in `doc/`.
- **`domain-features.md`** — Main capabilities, dependencies, non-obvious constraints.
- **`feature-logic-summary.md`** — Links to each `features/<name>.md` with one-line descriptions.
- **`features/`** — Deep dives for flows that need more than a short paragraph.

## 4. Feature definition rule

Feature docs describe **domain behavior**, not the source tree.

**Good file name examples:**

- `google-sso-and-domain-gate.md`
- `weekly-timesheet-entry-and-submit.md`
- `friday-reminder-notifications.md`

**Invalid as primary feature doc names:**

- Names that mirror a single React component (`WeeklyTimesheet.md`).
- Names that mirror only a route file (`route.md`, `page.md`).

Inside a doc, **Source Code References** may list components and routes; the **title** stays domain-centric.

## 5. When detailed feature docs are mandatory

Create or update a file under `features/` when **any** of:

- Behavior spans **multiple** implementation files.
- More than **three** non-trivial conditions or branches.
- **Validation** rules exist.
- **State transitions** must stay consistent.
- The behavior is **business-critical**.

## 6. Required reading order

Before implementing in `<feature-area>`:

1. `doc/features/<feature-area>/README.md`
2. `doc/features/<feature-area>/domain-features.md`
3. `doc/features/<feature-area>/feature-logic-summary.md`
4. Relevant `doc/features/<feature-area>/features/*.md`
5. Application code

## 7. Maintenance rule

When **user flows**, **API contracts**, or **business logic** change, update the same feature-area docs in the **same change**. If a follow-up is unavoidable, the task report must call out **pending doc debt**.

## 8. Enforcement

An implementation is **incomplete** if:

- Feature-area docs are **missing** for new meaningful behavior.
- Docs are **outdated** relative to shipped code.
- Docs **only mirror** code structure without explaining behavior, rules, and contracts.

Use [../feature-logic-summary.md](../feature-logic-summary.md) to resolve `<feature-area>` names consistently.

# Lint and quality gates — shopstack-timesheet

## 1. Mandatory commands

After implementation, from the **repository root**, run:

```bash
npx tsc --noEmit
```

```bash
npm run lint
```

(`npm run lint` runs `next lint` per `package.json`.)

## 2. Rules

- **Both** commands must **pass** for changes you introduced before the task is complete.
- The agent must **report** the exact commands run and whether they passed or failed.

## 3. Handling existing issues

- Fix **all** issues in files you modified.
- For untouched files with pre-existing problems, document them in the task report (file path + rule id + short description).
- Prefer minimal fixes when touching a file with easy-to-fix legacy lint issues.

## 4. Completion gate

The task is **incomplete** if:

- `npx tsc --noEmit` reports errors caused by the agent’s changes and they are not fixed.
- `npm run lint` reports **new** errors in changed files and they are not fixed.

Do not claim “done” without stating TypeScript and ESLint outcomes in the final report format defined in [../ai-agent-instruction.md](../ai-agent-instruction.md).

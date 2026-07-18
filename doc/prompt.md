# Agent session hint — shopstack-timesheet

Before you implement anything in this repo:

1. Open and follow **[doc/ai-agent-instruction.md](./ai-agent-instruction.md)** end-to-end.
2. Read **all** mandatory files in **[doc/rules/](./rules/)** listed there (`coding`, `testing`, `lint`, `documentation`, `implementation_completion`, `feature-area-documentation`, `manual_documentation_template`).
3. Identify the **feature area** via **[doc/feature-logic-summary.md](./feature-logic-summary.md)**, then read **`doc/features/<feature-area>/`** in order: `README.md` → `domain-features.md` → `feature-logic-summary.md` → `features/*.md`. Create missing docs if you are changing behavior.
4. Reuse **TypeScript types and helpers** from existing modules—**never guess** Zoho/Sheets response shapes.
5. **Never** call Zoho, Google Sheets, Slack, or SMTP from client code; only **`/api/*`** Route Handlers and server-only `src/lib/*` may integrate upstream.
6. See **[doc/README.md § Team implementation principles](./README.md#team-implementation-principles)** for stakeholder expectations (structure, docs, standards, server-side integrations, auth domain gate).

---

.... WHAT DO YOU WANT TO IMPLEMENT .....

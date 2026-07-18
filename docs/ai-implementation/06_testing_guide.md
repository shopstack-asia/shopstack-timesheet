# 06 — Testing Guide

```bash
npm test
```

## Suites added

| File | Coverage |
|------|----------|
| `merge.test.ts` | add/update/delete/clear/duplicate |
| `resolution.test.ts` | project/task match cases |
| `guardrails.test.ts` | hours, leave, holiday, future, clear |
| `confirmation.test.ts` | claim once, wrong user, cancel |
| `dates-slack.test.ts` | dates + Slack signature |

Existing: `sheets-write-lock.test.ts`, `submit-week-days.test.ts`.

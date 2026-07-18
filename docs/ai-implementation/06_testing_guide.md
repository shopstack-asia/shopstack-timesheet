# 06 — Testing Guide

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

There is no `type-check` script; use `npx tsc --noEmit`.

## Suites

| File | Coverage |
|------|----------|
| `merge.test.ts` | add/update/delete/clear/duplicate |
| `resolution.test.ts` | project/task match cases |
| `guardrails.test.ts` | hours, leave, holiday, future, over-24, custom project disabled, CLEAR |
| `confirmation.test.ts` | concurrent atomic claim, wrong user, expired, Slack `event_id` dedupe |
| `confirm-keywords.test.ts` | deterministic YES/CLEAR/OVERRIDE; soft phrases rejected |
| `verify.test.ts` | post-save match/mismatch/empty |
| `stale-and-correction.test.ts` | targetEntryKey correction; stale re-merge keeps concurrent D |
| `leave-override-and-safety.test.ts` | OVERRIDE then YES; empty clear; custom project reject |
| `partial-write.test.ts` | upsert failure must not call delete |
| `dates-slack.test.ts` | dates + Slack signature |

Existing: `sheets-write-lock.test.ts`, `submit-week-days.test.ts`.

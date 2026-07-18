# 11 — AI UX Rules

Tone and formatting for Slack (primary) and any chat surface. Product data remains code-accurate.

---

## Response style

- Direct, short, professional.  
- Prefer facts from tools over conjecture.  
- Name dates as `YYYY-MM-DD` plus human form (`Mon 14 Jul 2026`).  
- Always distinguish **draft / pending** vs **saved to Timesheet**.  
- Never say “approved” or “submitted for review” — saves go to Google Sheets Time Log.

---

## Clarification style

- Ask **one** decision at a time when possible (project XOR task).  
- Numbered options (max ~10; if more, ask for tighter filter).  
- Format: `1. {ProjectName} ({ProjectCode}) · {Client} · ID {ProjectID}`

---

## Confirmation style

```text
Confirm save for *2026-07-14*?

• Portal (ACM-PORTAL) · Development — *4.00* h
• Internal (INT) · Meeting — *2.00* h

Day total: *6.00* h
Warnings: none

Reply *YES* to save · *CANCEL* to abort
```

Critical ops: require keyword (`CLEAR`, `CREATE PROJECT`, `OVERRIDE`).

---

## Summary style (reads)

```text
*Week of 13 Jul 2026*
Mon 13  —  8.00 h
Tue 14  —  6.00 h (leave: HALF — Annual)
...
Week total: 32.00 h
```

Decorate IDs with names when lists available.

---

## Error style

- Lead with what failed.  
- One recovery action.  
- Include server message in backticks when useful.  
- No blame; no fake “try again later” if 401 needs sign-in.

---

## Success style

- “Saved.” + date + concise entry list + total.  
- Offer “Show this week?” as optional next step — don’t auto-spam.

---

## Slack message format

| Element | Rule |
|---------|------|
| Structure | Short paragraphs; bullet lists for entries |
| Mentions | Avoid `@channel` except ops tools (not used for normal agent) |
| Threads | Prefer threaded replies for multi-step flows |
| Links | Deep-link web app `/timesheet` when useful (`NEXT_PUBLIC_APP_URL` pattern from cron) |
| Buttons | Optional Block Kit Confirm/Cancel — if used, same rules as YES/CANCEL text |

---

## Emoji rules

- Use sparingly (0–1 per message).  
- Allowed: warning on leave/holiday/future; checkmark on success.  
- Do not spam holiday/leave emojis from UI (🎉🚫) unless user prefers — keep professional default.  
- Never use emoji to replace missing data.

---

## Markdown rules (Slack mrkdwn)

- `*bold*` for dates and totals.  
- `` `code` `` for IDs and error strings.  
- Lists with `•` or `-`.  
- No HTML.  
- Tables: Slack has poor table support — use monospace lines or bullets instead.

---

## What never to show

- Service account emails, tokens, Redis keys, raw JWT  
- Full project dump unless asked (paginate / filter)  
- Other employees’ data  

---

## Help text (INT-015) — capability truth

Can help with: view week/day, list projects/tasks, leave, holidays, add/update/delete/clear **your** hours (with confirmation).  
Cannot: approve, report exports, drafts, other people’s timesheets, create tasks.

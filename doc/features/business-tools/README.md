# Business Tools — feature area

AI Business Tools for Timesheet read and confirmation-gated write.

## Scope

AI-visible read tools:

- `get_my_profile` — current employee identity from Conversation Context (canonical Time Log Staff ID; no Zoho re-lookup)
- `get_work_context`
- `get_timesheet` — one `YYYY-MM-DD`
- `get_timesheet_range` — inclusive start/end, max 31 days

AI-visible write tools (prepare never writes Sheets):

- `prepare_create_timesheet_entry`
- `prepare_update_timesheet_entry`
- `prepare_delete_timesheet_entry`
- `prepare_submit_timesheet` — returns `unsupported` (no separate submitted state)
- `confirm_timesheet_change`
- `cancel_timesheet_change`

Deprecated compatibility wrappers (not AI-registered):

- `get_today_timesheet` → shared daily load for Bangkok today
- `get_week_timesheet` → shared range load for Bangkok current week

## Out of scope

Leave, holiday, approvals; unconfirmed direct Sheets writes; custom Project creation from Slack; inventing Submit Week submitted state.

## Reading order

1. This README  
2. [domain-features.md](./domain-features.md)  
3. [feature-logic-summary.md](./feature-logic-summary.md)  
4. [Timesheet Write Foundation.md](./Timesheet%20Write%20Foundation.md)  
5. [Get My Profile.md](./Get%20My%20Profile.md)  
6. [Work Context.md](./Work%20Context.md)  
7. [Get Timesheet.md](./Get%20Timesheet.md)  
8. [Get Timesheet Range.md](./Get%20Timesheet%20Range.md)  
9. [Conversation Context.md](./Conversation%20Context.md)  
10. [Identity Resolution.md](./Identity%20Resolution.md)  
11. Deprecated: [Get Today Timesheet.md](./Get%20Today%20Timesheet.md), [Get Week Timesheet.md](./Get%20Week%20Timesheet.md)

## Related

- [business](../business/) — HTTP client
- [tools](../tools/) — registry / executor
- [ai](../ai/) — conversation + prompt
- [timesheet](../timesheet/) — canonical Sheets read/write

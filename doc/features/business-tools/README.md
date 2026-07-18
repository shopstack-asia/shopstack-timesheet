# Business Tools — feature area

Read-only AI Business Tools that call Timesheet API via the Business API Client.

## Scope (Phase 9.6 — Read complete)

AI-visible tools:

- `get_work_context`
- `get_timesheet` — one `YYYY-MM-DD`
- `get_timesheet_range` — inclusive start/end, max 31 days

Deprecated compatibility wrappers (not AI-registered):

- `get_today_timesheet` → shared daily load for Bangkok today
- `get_week_timesheet` → shared range load for Bangkok current week

## Out of scope

Create / update / delete / submit timesheet, leave, holiday, approvals.

## Reading order

1. This README  
2. [domain-features.md](./domain-features.md)  
3. [feature-logic-summary.md](./feature-logic-summary.md)  
4. [Work Context.md](./Work%20Context.md)  
5. [Get Timesheet.md](./Get%20Timesheet.md)  
6. [Get Timesheet Range.md](./Get%20Timesheet%20Range.md)  
7. [Conversation Context.md](./Conversation%20Context.md)  
8. [Identity Resolution.md](./Identity%20Resolution.md)  
9. Deprecated: [Get Today Timesheet.md](./Get%20Today%20Timesheet.md), [Get Week Timesheet.md](./Get%20Week%20Timesheet.md)

## Related

- [business](../business/) — HTTP client
- [tools](../tools/) — registry / executor
- [ai](../ai/) — conversation + prompt

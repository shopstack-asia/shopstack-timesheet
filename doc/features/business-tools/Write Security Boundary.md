# Write Security Boundary

## Forbidden for AI / Business Tools

- Accept `employeeId`, `staffId`, `email`, `slackUserId` from AI
- Resolve Slack or Zoho identity inside write tools
- Write for another employee
- Register unconfirmed direct-write tools for OpenAI
- Create custom Projects from Slack (`allowCustomProject: false`)
- Reconstruct mutation payloads on confirm

## Allowed

- Prepare tools: business fields only + Conversation Context identity
- Confirm: `confirmationId` only
- Canonical writer shared with Weekly Timesheet UI

## Audit

Structured logs (`scope: timesheet-write-audit`) include request/event/conversation ids, operation, confirmationId, target date, counts/hours before/after, duration, safe error codes — not secrets, raw Sheets rows, or other employees’ data.

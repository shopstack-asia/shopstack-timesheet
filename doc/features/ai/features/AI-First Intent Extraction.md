# AI-First Intent Extraction (NLU)

## Summary

The Slack Timesheet Agent uses **AI-first structured intent extraction** when `AI_INTENT_EXTRACTION_ENABLED=true`. Natural Thai/English is understood by the model; **deterministic code** validates, resolves masters, selects Business Tools, and enforces confirmation.

Architecture:

```text
User text
  → (optional) load intent draft
  → AI structured intent (JSON schema)
  → deterministic enforce (dates, hours, Project/Task, tool mapping)
  → Business Tool / clarification
  → (writes) prepare → confirm → fenced Redis execution → Sheets
```

This replaces “regex must match the full sentence” as the primary NLU path. Regex remains for bare confirm/cancel, ISO date safety, and **fallback** when extraction fails.

## Feature flag

| Env | Effect |
|-----|--------|
| `AI_INTENT_EXTRACTION_ENABLED=true` | AI extraction first |
| unset / false | Existing `decideBusinessTool` regex engine only |

## Structured intent (proposal only)

Validated with Zod (`StructuredIntentSchema`). Forbidden keys: `employeeId`, `email`, `slackUserId`, `staffId`, `timesheetStaffId`, Zoho IDs.

Supported intents map to tools:

| Intent | Tool |
|--------|------|
| `get_my_profile` | `get_my_profile` |
| `get_work_context` | `get_work_context` |
| `get_timesheet_day` | `get_timesheet` |
| `get_timesheet_range` | `get_timesheet_range` |
| `create_timesheet_entry` | `prepare_create_timesheet_entry` |
| `update_timesheet_entry` | `prepare_update_timesheet_entry` |
| `delete_timesheet_entry` | `prepare_delete_timesheet_entry` |
| `confirm_timesheet_change` | `confirm_timesheet_change` |
| `cancel_timesheet_change` | `cancel_timesheet_change` |
| `submit_timesheet` | `prepare_submit_timesheet` (returns unsupported) |
| `general_conversation` | no Business Tool |
| `unknown` (business-like) | clarification |

The model cannot authorize an arbitrary tool. Round-0 `enforceRequiredBusinessTool` still overwrites wrong tool calls.

## Deterministic enforcement

After extraction, code:

- Resolves Bangkok dates / ranges
- Validates hours and required fields
- Resolves Project/Task via canonical masters (exact → unique alias/initials → conservative fuzzy); clarifies on ambiguity; never invents IDs
- Rejects custom Project creation (`allowCustomProject: false` on confirm write)
- Stores a **non-identity** intent draft when fields are missing (TTL 10 min, scoped to Slack user + conversation)
- Never writes Sheets during prepare

## Clarification vs general conversation

Incomplete but recognizable Timesheet requests **clarify** (ask only for missing slots). They must not fall through to general conversation or invent “cannot access / identity” messages unless a real identity path failed.

## Follow-up drafts

Draft fields: intent, date, project/task hints or resolved IDs, hours, missingFields, timestamps. **No employee identity.** Identity is loaded from Conversation Context when the Business Tool runs.

Drafts are distinct from Redis **pending write confirmations**.

## Fallback

If structured extraction fails technically: log `fallbackUsed`, run regex `decideBusinessTool`. If text still looks Timesheet-related and the regex returns `none`, return a controlled clarification — never silent general chat with invented business data.

## Error integrity

Typed reasons include `project_not_found`, `task_not_found`, `ambiguous_project`, `ambiguous_task`, `validation_failed`, `extraction_failed`, `malformed_intent`, `read_failed`, `redis_unavailable`, `identity_unavailable`. Responses must match the real failure; Project/Task/Redis/parse failures must not be narrated as identity failures.

## Observability

Safe logs (`scope: ai-intent`): requestId, eventId, conversationId, extraction outcome, intent, confidence, missing fields, selected tool, clarification reason, fallback flag, typed error code. No Slack email, employeeId, Redis payloads, full Timesheet bodies, or secrets.

## Code

- `src/lib/ai/intent/*` — schema, extract, enforce, drafts, decide orchestrator
- `src/lib/ai/conversation.ts` — wires AI-first decide when flag enabled
- `src/lib/ai/decision-engine.ts` — regex fallback / flag-off path
- `src/lib/timesheet/write/master-resolve.ts` — Project/Task resolution

## Required tests

Covered in `src/lib/ai/intent/intent-nlu.test.ts`: natural-language create fixtures, clarifications, drafts, safety, error integrity, flag-off regression.

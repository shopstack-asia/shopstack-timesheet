# Work Context

## Tool

`get_work_context`

## Purpose

Return everything required for future Timesheet creation in **one** tool call.

## Architecture

```text
Slack → Conversation → OpenAI → Tool Router → get_work_context
  → Business API Client → GET /v1/work-context → Timesheet API
```

```mermaid
sequenceDiagram
  participant U as User
  participant AI as OpenAI
  participant T as get_work_context
  participant C as Business API Client
  participant API as Timesheet API

  U->>AI: Log 8 hours today
  AI->>T: execute()
  T->>C: GET /v1/work-context
  C->>API: Bearer request
  API-->>C: WorkContext
  C-->>T: data
  T-->>AI: context + selection hints
  alt exactly one client/project/role
    AI-->>U: confirm auto-selected values (no write yet)
  else multiple choices
    AI-->>U: ask which client/project/role
  end
```

## Response shape

```ts
interface WorkContext {
  user: { id: string; name: string };
  clients: Client[];
}

interface Client {
  id: string;
  name: string;
  projects: Project[];
}

interface Project {
  id: string;
  name: string;
  roles: Role[];
}

interface Role {
  id: string;
  name: string;
}
```

Tool result also includes `selection` hints (`autoSelectable`, message).

## Business rules

- Auto-select only when exactly one Client, Project, and Role
- Otherwise ask the user — never guess
- Conversation memory only (no permanent store)
- Do not create timesheet in this phase

## API

| Method | Path |
|--------|------|
| GET | `/v1/work-context` |

## Error cases

| Case | Tool `errorCode` |
|------|------------------|
| Auth failure | `authentication` |
| Timeout | `timeout` |
| Upstream 5xx | `unexpected` |
| Malformed body | `validation_error` |

## Source Code References

- `src/lib/tools/business/context/get-work-context.ts`

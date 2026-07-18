# 08 — Slack Readiness

**Question:** Is the current backend sufficient to integrate a Slack AI timesheet agent?  
**Scope:** Findings only — no implementation proposal.

**Analyzed commit:** `e8af4c6095ffcc6131f8beed890719bd3bc4d9ca`

---

## Verdict

**Not sufficient as-is for a safe Slack AI that writes timesheets or acts as a general employee assistant.**

**Partially sufficient for a read-only Slack assistant** if Slack identity can be bound to an existing NextAuth/Zoho employee session by a layer **outside** current APIs (that binding does not exist in this repo).

---

## What already exists that Slack could reuse

| Capability | Evidence |
|------------|----------|
| Slack Web API dependency | `@slack/web-api` in package.json |
| Outbound Slack messages | `POST /api/cron/friday-reminder` channel posts; `/api/debug/slack-test` |
| Env | `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` / `SLACK_CHANNEL_IDS` |
| Employee timesheet HTTP APIs | get, submit, master, leave, holidays, profile |
| Zoho email → StaffProfile | Used at Google sign-in |

---

## Missing before Slack AI integration (gaps in this codebase)

| Gap | Why it blocks Slack AI | Evidence |
|-----|------------------------|----------|
| Slack user ↔ EmployeeID mapping | Bot cannot know which Sheets staff row to use | No Slack ID on StaffProfile; no mapping table/API |
| Non-browser authentication for APIs | Timesheet APIs expect NextAuth session cookie | `getServerSession` + middleware |
| Service account / delegated user token | No way for bot to call APIs “as” employee | Not found |
| Entry-level CRUD | Slack flows usually one entry at a time; API is day-replace | submit route |
| Server-side leave/holiday enforcement | UI rules bypassable by bot calling submit | DailyCard vs submit |
| Approval workflow | Common Slack expectation; absent | No APIs |
| Draft / confirm step API | No human-confirmation token or pending state | Not found |
| Audit log of writes | Needed for bot attribution | Not found |
| Idempotency keys | Slack retries / double taps | Not found |
| Search projects/tasks | Natural language → ID needs list+match or new search | List-only APIs |
| Structured error codes | Agents need stable codes; responses are free-string `error` | ApiResponse |
| Secure debug surface | `/api/debug/slack-test` unauthenticated | debug routes |
| Per-user DM reminder / incomplete detection | Only channel blast + mass email | friday-reminder |

---

## Slack features present vs agent needs

| Slack use today | Agent need |
|-----------------|------------|
| Optional Friday `@channel` reminder | Interactive DM, slash commands, modals — **not in app** |
| Debug post message | Production inbound Events API / interactivity — **not in app** |

Inbound Slack (Events API, slash commands, interactivity handlers): **Not found** under `src/`.

---

## Sufficiency by agent mode

| Mode | Sufficient? | Basis |
|------|-------------|--------|
| Slack posts reminder links to web app | Yes (already) | friday-reminder |
| Slack read-only Q&A (“what did I log this week?”) | Backend data APIs exist; **identity bridge missing** | get + profile |
| Slack create/edit hours via chat | **No** — auth bridge + day-replace semantics + missing guards | submit |
| Slack approve/reject | **No** — feature absent | — |
| Slack as replacement UI for full week grid | **No** — would need orchestration and UX confirmation not in API | — |

---

## Related risks if Slack called submit today (hypothetical)

Documented in [06_ai_integration_risks.md](./06_ai_integration_risks.md): custom project creation on unknown ID, empty-array wipe, no leave check, partial multi-day writes, unauthenticated debug.

---

## Checklist: missing before integrating Slack AI

Findings checklist (not a build plan):

1. Identity: Slack user → `@shopstack.asia` / Zoho `EmployeeID`  
2. Auth: how HTTP APIs are invoked without browser NextAuth cookie  
3. Write contract: safe single-entry or documented day-replace + merge rules  
4. Enforce leave/holiday (and approval-status policy) on server if product requires it  
5. Confirmation / audit for bot-initiated writes  
6. Remove or lock down unauthenticated debug Slack/email/Zoho probes  
7. Clarify that “submit” ≠ approval  
8. Decide search/disambiguation strategy using list APIs only (no search API today)

---

## Confidence

| Statement | Classification |
|-----------|----------------|
| APIs and gaps listed above | Confirmed by code |
| “Sufficient for production Slack AI writes” | **False** given missing identity/auth/guards |
| Outbound Slack reminder exists | Confirmed by code |

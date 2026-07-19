# Pending Timesheet Change Lifecycle

## Statuses

`pending` → `executing` → `completed`  
also: `cancelled` | `expired` | `conflict` | `failed`

## TTL

Default **10 minutes** from create (`PENDING_CHANGE_TTL_MS`).

## Store operations

`create` · `get` · `claimForExecution` · `markCompleted` · `markCancelled` · `markConflict` · `markFailed` · `deleteExpired` · `findPendingByConversation`

## Idempotency / concurrency

- Atomic claim prevents double execution
- Completed result stored for Slack event retries
- Snapshot hash conflict refuses overwrite of newer data

## Scaling

In-memory store is **per process**. Document Redis before horizontal scale — do not claim distributed safety from the in-memory implementation.

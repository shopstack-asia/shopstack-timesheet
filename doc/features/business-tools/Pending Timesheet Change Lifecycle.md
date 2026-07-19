# Pending Timesheet Change Lifecycle

## Why not in-memory on Vercel

Slack prepare and confirm are separate HTTP requests. On serverless they may hit different instances or a cold start. An in-memory `Map` cannot share pending state, cannot atomically claim across instances, and cannot retain completed results for Slack retries. Production therefore uses the repository Redis adapter (`getRedisClient()`). There is **no silent in-memory fallback**.

## Redis key structure (no secrets)

| Key | Purpose |
|-----|---------|
| `timesheet:pending-change:{confirmationId}` | Full pending record JSON (snapshots, hashes, writeEntries, summary, ownership ids, status, timestamps) |
| `timesheet:pending-by-conv:{conversationId}` | Redis SET of confirmationIds for bare ยืนยัน/ยกเลิก discovery |

Does **not** store Slack email or AI-supplied identity.

## TTL and retention

| State | TTL |
|-------|-----|
| `pending` / `executing` / terminal non-completed | **10 minutes** (`PENDING_CHANGE_TTL_SECONDS`) |
| `completed` (safe result for retries) | **30 minutes** (`COMPLETED_RETENTION_SECONDS`) |

Keys expire; they must not leak indefinitely.

## Statuses

`pending` → `executing` → `completed`  
also: `cancelled` | `expired` | `conflict` | `failed`

## Atomic transitions (Lua / compare-and-set)

Implemented via Redis `EVAL` scripts on the shared adapter (not read-then-write):

- **create**: `SET NX` + conversation `SADD` — refuses overwrite of an existing confirmationId
- **claim**: only `pending` → `executing` (sets `claimedAt` / `claimedAtMs`)
- **cancel**: only `pending` → `cancelled`
- **markCompleted / conflict / failed**: CAS on allowed prior statuses

## Concurrent confirm

Only one claim succeeds. Others see `executing` and return `already_processing`, or return the stored `completed` result after the winner finishes. This is **idempotent confirmation with reconciliation**, not a claim of exactly-once across all crash boundaries without read-back.

## Crash recovery (90s executing lease)

Atomic claim (`LUA_CLAIM`) persists both `claimedAt` (ISO) and `claimedAtMs` (epoch ms). Reclaim (`LUA_RECLAIM`) uses `claimedAtMs` only.

If status is `executing` and `claimedAtMs` is older than `EXECUTING_LEASE_MS` (90s):

1. Attempt `reclaimStaleExecution`
2. Read current day; fail closed if incomplete
3. If current **content** equals **proposed** → mark completed **without** writing again
4. If current equals **original** → allow **one** controlled write retry
5. Otherwise → `conflict`, zero writes

Within the lease window, return `already_processing` (do not claim success without a completed result).

## Confirm vs cancel race

Cancel uses atomic `pending` → `cancelled` only. If confirm has already claimed (`executing`), cancel does **not** report success — it returns that the change cannot be cancelled because execution is in progress.

## Redis unavailable

Fail closed: prepare / confirm / cancel return `unavailable` with a safe message. **Zero** Sheets writes. Never bypass confirmation. Never switch to process memory.

## Complete-day snapshots

`buildDaySnapshot` fails closed on missing `projectId`/`taskId`, invalid hours, or duplicate project+task. Silent filtering was removed so whole-day replace cannot omit existing rows.

## Operations

`create` · `get` · `claimForExecution` · `reclaimStaleExecution` · `markCompleted` · `markCancelled` · `markConflict` · `markFailed` · `findPendingByConversation`

In-memory store: **test double only** (`createInMemoryPendingTimesheetChangeStore`).

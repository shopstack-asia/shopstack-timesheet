# Pending Timesheet Change Lifecycle

## Why not in-memory on Vercel

Slack prepare and confirm are separate HTTP requests. On serverless they may hit different instances or a cold start. An in-memory `Map` cannot share pending state, cannot atomically claim across instances, and cannot retain completed results for Slack retries. Production therefore uses the repository Redis adapter (`getRedisClient()`). There is **no silent in-memory fallback**.

## Design phrase

**Idempotent confirmation with snapshot reconciliation and fenced execution leases.**

This is **not** absolute exactly-once execution across Redis and Google Sheets. Redis fencing prevents a stale worker from finalizing or overwriting state owned by a newer worker. Sheets writes are minimized by a pre-write ownership check, but Redis and Sheets are not a single distributed transaction.

## Redis key structure (no secrets)

| Key | Purpose |
|-----|---------|
| `timesheet:pending-change:{confirmationId}` | Full pending record JSON (snapshots, hashes, writeEntries, summary, ownership ids, status, `executionVersion`, timestamps) |
| `timesheet:pending-by-conv:{conversationId}` | Redis SET of confirmationIds for bare ยืนยัน/ยกเลิก discovery |

Does **not** store Slack email or AI-supplied identity.

## TTL and retention

| State | TTL |
|-------|-----|
| `pending` / `executing` / terminal non-completed | **10 minutes** (`PENDING_CHANGE_TTL_SECONDS`) |
| `completed` (safe result for retries) | **30 minutes** (`COMPLETED_RETENTION_SECONDS`) |

Keys expire; they must not leak indefinitely. A worker that has lost `executionVersion` ownership must not change TTL or overwrite `completedResult`.

## Statuses and valid transitions

| From | To | How |
|------|-----|-----|
| `pending` | `executing` | Initial claim (`claimForExecution`) — bumps `executionVersion` |
| `executing` (stale lease) | `executing` | Stale reclaim (`reclaimStaleExecution`) — bumps `executionVersion` |
| `executing` | `completed` | `markCompleted(id, executionVersion, …)` — fenced |
| `executing` | `failed` | `markFailed(id, executionVersion, …)` — fenced |
| `executing` | `conflict` | `markConflict(id, executionVersion)` — fenced |
| `pending` | `cancelled` | `markCancelled` — atomic cancel only |

**Invalid (must reject):**

- `pending` → `completed` / `failed` / `conflict`
- Any finalize with a mismatched `executionVersion`
- Cancel when status is already `executing` (report in-progress, not cancelled success)

Also terminal: `expired` (TTL / claim-time expiry).

## Execution fencing (`executionVersion`)

Each pending record carries a monotonically increasing `executionVersion` (integer). While `pending` / never claimed, it is `0`.

### Initial claim

Atomically:

1. Verify `status === pending` (and not expired)
2. `status = executing`
3. `executionVersion = previous + 1` (first claim → `1`)
4. Set `claimedAt` (ISO) and `claimedAtMs` (epoch ms)

The claimed record returned to the worker includes its `executionVersion`.

### Stale reclaim

Atomically:

1. Verify `status === executing`
2. Verify lease expired (`nowMs - claimedAtMs >= EXECUTING_LEASE_MS`, default 90s)
3. `executionVersion = previous + 1`
4. Refresh `claimedAt` / `claimedAtMs`

Only one concurrent reclaim wins; losers keep seeing the newer owner’s version.

### Final transitions require ownership

`markCompleted`, `markFailed`, and `markConflict` require the caller’s `executionVersion` to match the stored value **and** `status === executing`. Lua CAS (`LUA_FENCED_FINALIZE`) is authoritative.

An old worker with a stale version must not:

- mark completed / failed / conflict
- overwrite `completedResult` or `safeError`
- change TTL
- finalize a newer worker’s execution

## Authoritative CAS results

Every fenced finalize inspects the Lua (or memory CAS) result. Do **not** return a locally constructed success when Redis rejected the transition.

On success: return the persisted new state (`FenceTransitionResult.ok === true`).

On failure: reload / return the persisted record with reason:

- `ownership_lost`
- `missing`
- `wrong_status`

`confirmTimesheetChange` maps fence loss to the safe user result for the **actual** persisted state (cached `completedResult`, `already_processing`, conflict, failed, cancelled) — never “this worker completed” after losing the fence.

## Pre-write ownership verification

Required confirm sequence:

1. Claim or reclaim (obtain `executionVersion`)
2. Read current Timesheet snapshot
3. Reconcile original / proposed / conflict
4. **`assertExecutionOwnership(id, executionVersion)` immediately before the Sheets writer**
5. Call `submitDayTimesheetForStaff` only if ownership is still current
6. Read back the complete day
7. Finalize with the **same** `executionVersion`

If ownership was lost before the writer: **zero** Sheets writes; return `already_processing` (or equivalent from persisted state).

## Crash reconciliation (after stale reclaim)

| Current snapshot | Action |
|------------------|--------|
| Equals **proposed** | No write; `markCompleted` with new version; return completed result |
| Equals **original** | Verify ownership; one controlled write; read-back; finalize with new version |
| Matches **neither** | `markConflict` with new version; zero writes |
| **Incomplete** day | Fail closed; zero writes; `markFailed` only if ownership still held |

## Confirm vs cancel

Cancel succeeds only when Redis confirms `status === cancelled` (`pending` → `cancelled`).

- If confirm already owns execution → cancel returns in-progress / no pending; **never** cancellation success
- If cancel wins → confirm cannot claim; writer must not run

## Concurrent confirm

Only one claim/reclaim owner succeeds for a given version. Others see `executing` and return `already_processing`, or return the stored `completed` result after the winner finishes.

## Redis unavailable

Fail closed: prepare / confirm / cancel return `unavailable` with a safe message. **Zero** Sheets writes. Never bypass confirmation. Never switch to process memory.

## Complete-day snapshots

`buildDaySnapshot` fails closed on missing `projectId`/`taskId`, invalid hours, or duplicate project+task. Silent filtering was removed so whole-day replace cannot omit existing rows.

## Redis / Sheets limitation

There is no atomic transaction spanning Redis and Google Sheets. A worker can lose the fence after a Sheets write has already started or completed. Reconciliation (proposed already applied → complete without rewrite) and fenced finalizers limit damage; they do not provide absolute exactly-once.

## Operations

`create` · `get` · `claimForExecution` · `reclaimStaleExecution` · `assertExecutionOwnership` · `markCompleted` · `markCancelled` · `markConflict` · `markFailed` · `findPendingByConversation`

In-memory store: **test double only** (`createInMemoryPendingTimesheetChangeStore`) — must implement the same `executionVersion` fencing semantics.

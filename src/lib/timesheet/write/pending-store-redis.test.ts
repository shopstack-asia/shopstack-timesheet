import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createRedisPendingTimesheetChangeStore } from '@/lib/timesheet/write/pending-store-redis';
import { createInMemoryPendingTimesheetChangeStore } from '@/lib/timesheet/write/pending-store-memory';
import {
  resetDefaultPendingTimesheetChangeStore,
  PendingStoreError,
} from '@/lib/timesheet/write/pending-store';
import { buildDaySnapshot, hashDaySnapshot } from '@/lib/timesheet/write/snapshot-hash';
import {
  prepareCreateTimesheetEntry,
  prepareUpdateTimesheetEntry,
  prepareDeleteTimesheetEntry,
} from '@/lib/timesheet/write/prepare';
import { confirmTimesheetChange } from '@/lib/timesheet/write/confirm';
import { cancelTimesheetChange } from '@/lib/timesheet/write/cancel';
import { decideBusinessTool } from '@/lib/ai/decision-engine';
import {
  EXECUTING_LEASE_MS,
  INCOMPLETE_DAY_SAFE_MESSAGE,
} from '@/lib/timesheet/write/pending-types';
import type { DailyTimesheet } from '@/lib/tools/business/types';
import { createDefaultToolRegistry } from '@/lib/tools';

vi.mock('@/lib/timesheet/write/master-resolve', () => ({
  formatProjectLabel: (p: { ProjectName: string; ProjectCode: string }) =>
    `${p.ProjectName} (${p.ProjectCode})`,
  resolveProject: vi.fn(async (input: { projectId?: string; projectName?: string }) => ({
    status: 'resolved' as const,
    value: {
      ProjectID: input.projectId || 'P-HERTZ',
      ProjectName: 'Commerce Suite',
      ProjectCode: 'HERTZ',
      ProjectClient: 'Hertz',
    },
  })),
  resolveTask: vi.fn(async (input: { taskId?: string; taskName?: string }) => ({
    status: 'resolved' as const,
    value: { TaskID: input.taskId || 'T-DEV', Task: 'Development' },
  })),
}));

/**
 * Fake Redis that executes the pending-store Lua scripts in JS.
 * Shared Map simulates one Redis across multiple store wrapper instances.
 */
function createSharedFakeRedis(shared = new Map<string, string>()) {
  const sets = new Map<string, Set<string>>();

  function parseJson<T>(s: string): T {
    return JSON.parse(s) as T;
  }

  return {
    shared,
    async get<T>(key: string): Promise<T | null> {
      const v = shared.get(key);
      if (v == null) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return v as unknown as T;
      }
    },
    async setex(key: string, _seconds: number, value: string): Promise<void> {
      shared.set(key, value);
    },
    async setNx(key: string, value: string, _ttl: number): Promise<boolean> {
      if (shared.has(key)) return false;
      shared.set(key, value);
      return true;
    },
    async del(key: string): Promise<void> {
      shared.delete(key);
      sets.delete(key);
    },
    async expire(): Promise<void> {},
    async evalScript<T = unknown>(
      script: string,
      keys: string[],
      args: (string | number)[]
    ): Promise<T> {
      // CREATE
      if (script.includes("redis.call('SADD'") && script.includes('EXISTS')) {
        if (shared.has(keys[0]!)) return 0 as T;
        shared.set(keys[0]!, String(args[0]));
        let set = sets.get(keys[1]!);
        if (!set) {
          set = new Set();
          sets.set(keys[1]!, set);
        }
        set.add(String(args[2]));
        return 1 as T;
      }
      // SMEMBERS
      if (script.includes('SMEMBERS')) {
        const set = sets.get(keys[0]!) ?? new Set();
        return [...set] as T;
      }
      // CLAIM (pending → executing + bump executionVersion)
      if (script.includes("change.status ~= 'pending'") && script.includes('executionVersion')) {
        const raw = shared.get(keys[0]!);
        if (!raw) return JSON.stringify({ ok: false, status: 'missing' }) as T;
        const change = parseJson<Record<string, unknown>>(raw);
        const nowMs = Number(args[0]);
        const expiresAtMs = Number(change.expiresAtMs ?? 0);
        if (change.status === 'pending' && expiresAtMs > 0 && nowMs >= expiresAtMs) {
          change.status = 'expired';
          shared.set(keys[0]!, JSON.stringify(change));
          return JSON.stringify({ ok: false, status: 'expired' }) as T;
        }
        if (change.status !== 'pending') {
          return JSON.stringify({ ok: false, status: change.status }) as T;
        }
        change.status = 'executing';
        change.executionVersion = Number(change.executionVersion ?? 0) + 1;
        change.claimedAt = String(args[2]);
        change.claimedAtMs = nowMs;
        shared.set(keys[0]!, JSON.stringify(change));
        return JSON.stringify({ ok: true, change }) as T;
      }
      // RECLAIM (stale executing → executing + bump executionVersion)
      if (script.includes('local leaseMs') && script.includes('executionVersion')) {
        const raw = shared.get(keys[0]!);
        if (!raw) return JSON.stringify({ ok: false, status: 'missing' }) as T;
        const change = parseJson<Record<string, unknown>>(raw);
        if (change.status !== 'executing') {
          return JSON.stringify({ ok: false, status: change.status }) as T;
        }
        const claimedAtMs = Number(change.claimedAtMs ?? 0);
        const nowMs = Number(args[0]);
        const leaseMs = Number(args[1]);
        if (claimedAtMs === 0 || nowMs - claimedAtMs < leaseMs) {
          return JSON.stringify({ ok: false, status: 'executing' }) as T;
        }
        change.executionVersion = Number(change.executionVersion ?? 0) + 1;
        change.claimedAt = String(args[3]);
        change.claimedAtMs = nowMs;
        shared.set(keys[0]!, JSON.stringify(change));
        return JSON.stringify({ ok: true, change }) as T;
      }
      // CANCEL
      if (script.includes("change.status = 'cancelled'")) {
        const raw = shared.get(keys[0]!);
        if (!raw) return JSON.stringify({ ok: false, status: 'missing' }) as T;
        const change = parseJson<Record<string, unknown>>(raw);
        if (change.status !== 'pending') {
          return JSON.stringify({
            ok: false,
            status: change.status,
            change,
          }) as T;
        }
        change.status = 'cancelled';
        shared.set(keys[0]!, JSON.stringify(change));
        return JSON.stringify({ ok: true, change }) as T;
      }
      // ASSERT_OWNERSHIP — returns 1|0
      if (
        script.includes('currentVersion == expected') &&
        script.includes('return 1') &&
        !script.includes('ARGV[2]')
      ) {
        const raw = shared.get(keys[0]!);
        if (!raw) return 0 as T;
        const change = parseJson<Record<string, unknown>>(raw);
        const expected = Number(args[0]);
        if (
          change.status === 'executing' &&
          Number(change.executionVersion ?? 0) === expected
        ) {
          return 1 as T;
        }
        return 0 as T;
      }
      // FENCED_FINALIZE — status=executing AND version match
      if (script.includes('currentVersion ~= expected') && script.includes('ARGV[2]')) {
        const raw = shared.get(keys[0]!);
        if (!raw) return JSON.stringify({ ok: false, reason: 'missing' }) as T;
        const change = parseJson<Record<string, unknown>>(raw);
        const expected = Number(args[0]);
        if (change.status !== 'executing') {
          return JSON.stringify({
            ok: false,
            reason: 'wrong_status',
            status: change.status,
            change,
          }) as T;
        }
        if (Number(change.executionVersion ?? 0) !== expected) {
          return JSON.stringify({
            ok: false,
            reason: 'ownership_lost',
            status: change.status,
            change,
          }) as T;
        }
        const next = parseJson<Record<string, unknown>>(String(args[1]));
        shared.set(keys[0]!, JSON.stringify(next));
        return JSON.stringify({ ok: true, change: next }) as T;
      }
      throw new Error(`Unhandled lua script in fake redis: ${script.slice(0, 80)}`);
    },
  };
}

const identity = {
  employeeId: 'S0005',
  email: 'test@shopstack.asia',
  slackUserId: 'U1',
  conversationId: 'C1',
};

function day(
  entries: Array<{
    id: string;
    projectId?: string;
    taskId?: string;
    hours: number;
    clientName?: string;
    projectName?: string;
    taskName?: string;
  }>
): DailyTimesheet {
  return {
    date: '2026-07-18',
    entries: entries.map((e) => ({
      id: e.id,
      projectId: e.projectId,
      taskId: e.taskId,
      hours: e.hours,
      clientName: e.clientName || 'Client',
      projectName: e.projectName || 'Project',
      taskName: e.taskName || 'Task',
    })),
    totalHours: entries.reduce((s, e) => s + e.hours, 0),
    expectedHours: 8,
    remainingHours: 0,
    submitted: false,
  };
}

const baseEntries = [
  {
    id: 'e1',
    projectId: 'P-MIT',
    taskId: 'T-PM',
    hours: 3,
    clientName: 'Mitrphol',
    projectName: 'RMS',
    taskName: 'Project Management',
  },
  {
    id: 'e2',
    projectId: 'P-SS',
    taskId: 'T-DEV',
    hours: 2,
    clientName: 'Shopstack',
    projectName: 'Commerce Suite',
    taskName: 'Development',
  },
];

describe('buildDaySnapshot fail-closed', () => {
  it('rejects missing projectId', () => {
    const r = buildDaySnapshot('2026-07-18', [
      { id: '1', taskId: 'T', hours: 1 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_project_id');
  });

  it('rejects missing taskId', () => {
    const r = buildDaySnapshot('2026-07-18', [
      { id: '1', projectId: 'P', hours: 1 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_task_id');
  });

  it('rejects non-finite hours', () => {
    const r = buildDaySnapshot('2026-07-18', [
      { id: '1', projectId: 'P', taskId: 'T', hours: Number.NaN },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_hours');
  });

  it('rejects duplicate project+task', () => {
    const r = buildDaySnapshot('2026-07-18', [
      { id: '1', projectId: 'P', taskId: 'T', hours: 1 },
      { id: '2', projectId: 'P', taskId: 'T', hours: 2 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('duplicate_entries');
  });

  it('hashes independently of order', () => {
    const a = buildDaySnapshot('2026-07-18', [
      { id: '1', projectId: 'A', taskId: 'T', hours: 1 },
      { id: '2', projectId: 'B', taskId: 'T', hours: 2 },
    ]);
    const b = buildDaySnapshot('2026-07-18', [
      { id: '2', projectId: 'B', taskId: 'T', hours: 2 },
      { id: '1', projectId: 'A', taskId: 'T', hours: 1 },
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(hashDaySnapshot(a.snapshot)).toBe(hashDaySnapshot(b.snapshot));
    }
  });
});

describe('production default store', () => {
  beforeEach(() => {
    resetDefaultPendingTimesheetChangeStore();
  });

  it('does not use in-memory as production default factory', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/timesheet/write/pending-store.ts'),
      'utf8'
    );
    expect(src).toContain('createRedisPendingTimesheetChangeStore()');
    expect(src).not.toMatch(
      /getDefaultPendingTimesheetChangeStore[\s\S]*createInMemoryPendingTimesheetChangeStore\(\)/
    );
  });
});

describe('Redis pending store (shared fake)', () => {
  it('prepare on wrapper A and confirm on wrapper B succeeds once', async () => {
    const redis = createSharedFakeRedis();
    const storeA = createRedisPendingTimesheetChangeStore(redis);
    const storeB = createRedisPendingTimesheetChangeStore(redis);
    let sheets = day(baseEntries);
    const readDaily = vi.fn(async () => sheets);
    const submitDay = vi.fn(
      async (
        _a: unknown,
        _d: string,
        entries: Array<{ projectId: string; taskId: string; hours: number }>
      ) => {
        sheets = day(
          entries.map((e, i) => ({
            id: `n${i}`,
            projectId: e.projectId,
            taskId: e.taskId,
            hours: e.hours,
          }))
        );
      }
    );

    const prepared = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 5,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      { pendingStore: storeA, readDaily }
    );
    expect(prepared.status).toBe('confirmation_required');
    if (prepared.status !== 'confirmation_required') return;

    const confirmed = await confirmTimesheetChange(
      identity,
      prepared.confirmationId,
      { pendingStore: storeB, readDaily, submitDay }
    );
    expect(confirmed.status).toBe('completed');
    expect(submitDay).toHaveBeenCalledTimes(1);
    expect(sheets.totalHours).toBe(10);

    const retry = await confirmTimesheetChange(
      identity,
      prepared.confirmationId,
      { pendingStore: storeA, readDaily, submitDay }
    );
    expect(retry.status).toBe('completed');
    expect(submitDay).toHaveBeenCalledTimes(1);
  });

  it('survives recreation of store wrapper over same Redis', async () => {
    const redis = createSharedFakeRedis();
    const store1 = createRedisPendingTimesheetChangeStore(redis);
    await store1.create({
      confirmationId: 'confirm_persist',
      operation: 'create_entry',
      conversationId: 'C1',
      slackUserId: 'U1',
      employeeId: 'S0005',
      date: '2026-07-18',
      originalSnapshot: { date: '2026-07-18', entries: [] },
      originalSnapshotHash: 'h1',
      proposedSnapshot: { date: '2026-07-18', entries: [] },
      proposedSnapshotHash: 'h2',
      summary: 's',
      summaryPayload: {},
      writeEntries: [],
    });
    const store2 = createRedisPendingTimesheetChangeStore(redis);
    const got = await store2.get('confirm_persist');
    expect(got?.status).toBe('pending');
    expect(got?.conversationId).toBe('C1');
  });

  it('atomic claim: only one of two concurrent confirms writes', async () => {
    const redis = createSharedFakeRedis();
    const store = createRedisPendingTimesheetChangeStore(redis);
    let sheets = day(baseEntries);
    const readDaily = async () => sheets;
    let writes = 0;
    const submitDay = vi.fn(async (_a, _d, entries) => {
      writes += 1;
      await new Promise((r) => setTimeout(r, 20));
      sheets = day(
        entries.map((e: { projectId: string; taskId: string; hours: number }, i: number) => ({
          id: `w${i}`,
          projectId: e.projectId,
          taskId: e.taskId,
          hours: e.hours,
        }))
      );
    });

    const prepared = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 5,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      { pendingStore: store, readDaily }
    );
    if (prepared.status !== 'confirmation_required') return;

    const [a, b] = await Promise.all([
      confirmTimesheetChange(identity, prepared.confirmationId, {
        pendingStore: store,
        readDaily,
        submitDay,
      }),
      confirmTimesheetChange(identity, prepared.confirmationId, {
        pendingStore: store,
        readDaily,
        submitDay,
      }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(writes).toBe(1);
    expect(statuses).toContain('completed');
    expect(
      statuses.some((s) => s === 'already_processing' || s === 'completed')
    ).toBe(true);
  });

  it('claim persists claimedAtMs so stale lease can be reclaimed', async () => {
    const redis = createSharedFakeRedis();
    const store = createRedisPendingTimesheetChangeStore(redis);
    await store.create({
      confirmationId: 'confirm_lease',
      operation: 'create_entry',
      conversationId: 'C1',
      slackUserId: 'U1',
      employeeId: 'S0005',
      date: '2026-07-18',
      originalSnapshot: { date: '2026-07-18', entries: [] },
      originalSnapshotHash: 'h1',
      proposedSnapshot: { date: '2026-07-18', entries: [] },
      proposedSnapshotHash: 'h2',
      summary: 's',
      summaryPayload: {},
      writeEntries: [],
    });
    const claimed = await store.claimForExecution('confirm_lease');
    expect(claimed?.status).toBe('executing');
    expect(claimed?.executionVersion).toBe(1);
    expect(claimed?.claimedAt).toBeInstanceOf(Date);

    const raw = await redis.get<{
      claimedAtMs?: number;
      status?: string;
      executionVersion?: number;
    }>('timesheet:pending-change:confirm_lease');
    expect(raw?.status).toBe('executing');
    expect(raw?.executionVersion).toBe(1);
    expect(typeof raw?.claimedAtMs).toBe('number');
    expect(raw!.claimedAtMs!).toBeGreaterThan(0);

    // Fresh lease — reclaim must fail
    expect(await store.reclaimStaleExecution('confirm_lease', EXECUTING_LEASE_MS)).toBeNull();

    // Backdate claimedAtMs past the lease window
    const staleMs = Date.now() - EXECUTING_LEASE_MS - 1000;
    redis.shared.set(
      'timesheet:pending-change:confirm_lease',
      JSON.stringify({
        ...raw,
        claimedAt: new Date(staleMs).toISOString(),
        claimedAtMs: staleMs,
      })
    );
    const reclaimed = await store.reclaimStaleExecution(
      'confirm_lease',
      EXECUTING_LEASE_MS
    );
    expect(reclaimed?.status).toBe('executing');
    expect(reclaimed?.executionVersion).toBe(2);
    expect(reclaimed?.claimedAt).toBeInstanceOf(Date);
  });

  it('cancel loses race to claim and does not report cancelled', async () => {
    const redis = createSharedFakeRedis();
    const store = createRedisPendingTimesheetChangeStore(redis);
    await store.create({
      confirmationId: 'confirm_race',
      operation: 'create_entry',
      conversationId: 'C1',
      slackUserId: 'U1',
      employeeId: 'S0005',
      date: '2026-07-18',
      originalSnapshot: { date: '2026-07-18', entries: [] },
      originalSnapshotHash: 'h1',
      proposedSnapshot: { date: '2026-07-18', entries: [] },
      proposedSnapshotHash: 'h2',
      summary: 's',
      summaryPayload: {},
      writeEntries: [],
    });
    await store.claimForExecution('confirm_race');
    const result = await cancelTimesheetChange(identity, 'confirm_race', {
      pendingStore: store,
    });
    expect(result.status).not.toBe('cancelled');
    expect(result.status).toBe('no_pending_change');
    const still = await store.get('confirm_race');
    expect(still?.status).toBe('executing');
  });

  it('bare ยืนยัน discovers pending from shared store', async () => {
    const redis = createSharedFakeRedis();
    const store = createRedisPendingTimesheetChangeStore(redis);
    await store.create({
      confirmationId: 'confirm_bare',
      operation: 'create_entry',
      conversationId: 'C-BARE',
      slackUserId: 'U1',
      employeeId: 'S0005',
      date: '2026-07-18',
      originalSnapshot: { date: '2026-07-18', entries: [] },
      originalSnapshotHash: 'h1',
      proposedSnapshot: { date: '2026-07-18', entries: [] },
      proposedSnapshotHash: 'h2',
      summary: 'ต้องการบันทึก',
      summaryPayload: {},
      writeEntries: [],
    });
    const pending = await store.findPendingByConversation('C-BARE');
    const d = decideBusinessTool('ยืนยัน', {
      pendingChanges: pending.map((p) => ({
        confirmationId: p.confirmationId,
        summary: p.summary,
      })),
    });
    expect(d).toMatchObject({
      action: 'call_tool',
      toolName: 'confirm_timesheet_change',
      arguments: { confirmationId: 'confirm_bare' },
    });
  });

  it('bare ยกเลิก discovers pending from shared store', async () => {
    const redis = createSharedFakeRedis();
    const store = createRedisPendingTimesheetChangeStore(redis);
    await store.create({
      confirmationId: 'confirm_cancel',
      operation: 'create_entry',
      conversationId: 'C-CAN',
      slackUserId: 'U1',
      employeeId: 'S0005',
      date: '2026-07-18',
      originalSnapshot: { date: '2026-07-18', entries: [] },
      originalSnapshotHash: 'h1',
      proposedSnapshot: { date: '2026-07-18', entries: [] },
      proposedSnapshotHash: 'h2',
      summary: 'ต้องการบันทึก',
      summaryPayload: {},
      writeEntries: [],
    });
    const pending = await store.findPendingByConversation('C-CAN');
    const d = decideBusinessTool('ยกเลิก', {
      pendingChanges: pending.map((p) => ({
        confirmationId: p.confirmationId,
        summary: p.summary,
      })),
    });
    expect(d).toMatchObject({
      action: 'call_tool',
      toolName: 'cancel_timesheet_change',
    });
  });
});

describe('ownership / expiry / redis unavailable', () => {
  it('rejects other user, conversation, employee', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    const prepared = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 1,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      { pendingStore: store, readDaily: async () => day([]) }
    );
    if (prepared.status !== 'confirmation_required') return;
    const submitDay = vi.fn();
    expect(
      (
        await confirmTimesheetChange(
          { ...identity, slackUserId: 'U2' },
          prepared.confirmationId,
          { pendingStore: store, readDaily: async () => day([]), submitDay }
        )
      ).status
    ).toBe('failed');
    expect(
      (
        await confirmTimesheetChange(
          { ...identity, conversationId: 'C2' },
          prepared.confirmationId,
          { pendingStore: store, readDaily: async () => day([]), submitDay }
        )
      ).status
    ).toBe('failed');
    expect(
      (
        await confirmTimesheetChange(
          { ...identity, employeeId: 'S9999' },
          prepared.confirmationId,
          { pendingStore: store, readDaily: async () => day([]), submitDay }
        )
      ).status
    ).toBe('failed');
    expect(submitDay).not.toHaveBeenCalled();
  });

  it('expired and cancelled cannot execute', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    const prepared = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 1,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      {
        pendingStore: store,
        readDaily: async () => day([]),
      }
    );
    if (prepared.status !== 'confirmation_required') return;
    const pending = await store.get(prepared.confirmationId);
    // force expire
    await store.markCancelled(prepared.confirmationId);
    const submitDay = vi.fn();
    expect(
      (
        await confirmTimesheetChange(identity, prepared.confirmationId, {
          pendingStore: store,
          readDaily: async () => day([]),
          submitDay,
        })
      ).status
    ).toBe('cancelled');

    const store2 = createInMemoryPendingTimesheetChangeStore();
    await store2.create({
      confirmationId: 'confirm_exp',
      operation: 'create_entry',
      conversationId: 'C1',
      slackUserId: 'U1',
      employeeId: 'S0005',
      date: '2026-07-18',
      originalSnapshot: { date: '2026-07-18', entries: [] },
      originalSnapshotHash: 'h',
      proposedSnapshot: { date: '2026-07-18', entries: [] },
      proposedSnapshotHash: 'h2',
      summary: 's',
      summaryPayload: {},
      writeEntries: [],
      ttlMs: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(
      (
        await confirmTimesheetChange(identity, 'confirm_exp', {
          pendingStore: store2,
          readDaily: async () => day([]),
          submitDay,
        })
      ).status
    ).toBe('expired');
    expect(submitDay).not.toHaveBeenCalled();
    void pending;
  });

  it('Redis unavailable on prepare/confirm performs zero Sheets writes', async () => {
    const broken: PendingStoreError = new PendingStoreError(
      'REDIS_UNAVAILABLE',
      'down'
    );
    const store = {
      create: async () => {
        throw broken;
      },
      get: async () => {
        throw broken;
      },
      claimForExecution: async () => {
        throw broken;
      },
      reclaimStaleExecution: async () => {
        throw broken;
      },
      markCompleted: async () => ({ ok: false as const, reason: 'missing' as const }),
      markCancelled: async () => undefined,
      markConflict: async () => ({ ok: false as const, reason: 'missing' as const }),
      markFailed: async () => ({ ok: false as const, reason: 'missing' as const }),
      assertExecutionOwnership: async () => false,
      findPendingByConversation: async () => {
        throw broken;
      },
    };
    const submitDay = vi.fn();
    const prep = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 1,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      { pendingStore: store, readDaily: async () => day([]) }
    );
    expect(prep.status).toBe('unavailable');
    const conf = await confirmTimesheetChange(identity, 'confirm_x', {
      pendingStore: store,
      readDaily: async () => day([]),
      submitDay,
    });
    expect(conf.status).toBe('unavailable');
    expect(submitDay).not.toHaveBeenCalled();
    const can = await cancelTimesheetChange(identity, 'confirm_x', {
      pendingStore: store,
    });
    expect(can.status).toBe('unavailable');
  });
});

describe('crash recovery / incomplete day', () => {
  it('reconciles proposed snapshot without rewriting', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    const proposedEntries = [
      ...baseEntries,
      {
        id: 'e3',
        projectId: 'P-HERTZ',
        taskId: 'T-DEV',
        hours: 5,
        clientName: 'Hertz',
        projectName: 'Commerce Suite',
        taskName: 'Development',
      },
    ];
    const snap = buildDaySnapshot('2026-07-18', baseEntries);
    const prop = buildDaySnapshot(
      '2026-07-18',
      proposedEntries.map((e) => ({
        id: e.id,
        projectId: e.projectId!,
        taskId: e.taskId!,
        hours: e.hours,
      }))
    );
    expect(snap.ok && prop.ok).toBe(true);
    if (!snap.ok || !prop.ok) return;

    await store.create({
      confirmationId: 'confirm_reconcile',
      operation: 'create_entry',
      conversationId: 'C1',
      slackUserId: 'U1',
      employeeId: 'S0005',
      date: '2026-07-18',
      originalSnapshot: snap.snapshot,
      originalSnapshotHash: hashDaySnapshot(snap.snapshot),
      proposedSnapshot: prop.snapshot,
      proposedSnapshotHash: hashDaySnapshot(prop.snapshot),
      summary: 's',
      summaryPayload: {
        clientName: 'Hertz',
        projectName: 'CS',
        taskName: 'Development',
        hours: 5,
      },
      writeEntries: prop.snapshot.entries.map((e) => ({
        projectId: e.projectId,
        taskId: e.taskId,
        hours: e.hours,
      })),
    });
    await store.claimForExecution('confirm_reconcile');

    const sheets = day(proposedEntries);
    const submitDay = vi.fn();
    const wrapped = {
      ...store,
      async get(id: string) {
        const c = await store.get(id);
        if (c?.status === 'executing') {
          return {
            ...c,
            claimedAt: new Date(Date.now() - EXECUTING_LEASE_MS - 5),
          };
        }
        return c;
      },
      async reclaimStaleExecution(id: string, _leaseMs: number) {
        // Force reclaim success for stale lease test
        return store.reclaimStaleExecution(id, 0);
      },
    };

    const result = await confirmTimesheetChange(identity, 'confirm_reconcile', {
      pendingStore: wrapped,
      readDaily: async () => sheets,
      submitDay,
    });
    expect(result.status).toBe('completed');
    expect(submitDay).not.toHaveBeenCalled();
  });

  it('prepare fails closed when unrelated entry missing projectId', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    const result = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 1,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      {
        pendingStore: store,
        readDaily: async () =>
          day([
            { id: 'bad', taskId: 'T', hours: 2 },
            ...baseEntries,
          ]),
      }
    );
    expect(result.status).toBe('validation_failed');
    if (result.status === 'validation_failed') {
      expect(result.message).toBe(INCOMPLETE_DAY_SAFE_MESSAGE);
    }
    expect(await store.findPendingByConversation('C1')).toHaveLength(0);
  });

  it('prepare-update/delete fail closed on incomplete unrelated entry', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    const incomplete = day([
      { id: 'e1', projectId: 'P-MIT', taskId: 'T-PM', hours: 3 },
      { id: 'bad', projectId: 'P-X', hours: 1 },
    ]);
    const upd = await prepareUpdateTimesheetEntry(
      identity,
      { date: '2026-07-18', entryId: 'e1', hours: 4 },
      { pendingStore: store, readDaily: async () => incomplete }
    );
    expect(upd.status).toBe('validation_failed');
    const del = await prepareDeleteTimesheetEntry(
      identity,
      { date: '2026-07-18', entryId: 'e1' },
      { pendingStore: store, readDaily: async () => incomplete }
    );
    expect(del.status).toBe('validation_failed');
  });

  it('confirm fails closed on incomplete fresh day and does not write', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    const prepared = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 1,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      { pendingStore: store, readDaily: async () => day(baseEntries) }
    );
    if (prepared.status !== 'confirmation_required') return;
    const submitDay = vi.fn();
    const result = await confirmTimesheetChange(
      identity,
      prepared.confirmationId,
      {
        pendingStore: store,
        readDaily: async () =>
          day([{ id: 'bad', projectId: 'P', hours: 1 }, ...baseEntries]),
        submitDay,
      }
    );
    expect(result.status).toBe('failed');
    expect(submitDay).not.toHaveBeenCalled();
  });
});

describe('executionVersion fencing', () => {
  function pendingInput(id: string) {
    return {
      confirmationId: id,
      operation: 'create_entry' as const,
      conversationId: 'C1',
      slackUserId: 'U1',
      employeeId: 'S0005',
      date: '2026-07-18',
      originalSnapshot: { date: '2026-07-18', entries: [] as [] },
      originalSnapshotHash: 'h1',
      proposedSnapshot: {
        date: '2026-07-18',
        entries: [{ projectId: 'P', taskId: 'T', hours: 1 }],
      },
      proposedSnapshotHash: 'h2',
      summary: 's',
      summaryPayload: {},
      writeEntries: [{ projectId: 'P', taskId: 'T', hours: 1 }],
    };
  }

  async function makeLeaseStale(
    redis: ReturnType<typeof createSharedFakeRedis>,
    id: string
  ) {
    const raw = await redis.get<Record<string, unknown>>(
      `timesheet:pending-change:${id}`
    );
    const staleMs = Date.now() - EXECUTING_LEASE_MS - 1000;
    redis.shared.set(
      `timesheet:pending-change:${id}`,
      JSON.stringify({
        ...raw,
        claimedAt: new Date(staleMs).toISOString(),
        claimedAtMs: staleMs,
      })
    );
  }

  async function staleAndReclaim(
    redis: ReturnType<typeof createSharedFakeRedis>,
    store: ReturnType<typeof createRedisPendingTimesheetChangeStore>,
    id: string
  ) {
    await makeLeaseStale(redis, id);
    return store.reclaimStaleExecution(id, EXECUTING_LEASE_MS);
  }

  it('initial claim creates executionVersion 1; reclaim increments', async () => {
    const redis = createSharedFakeRedis();
    const store = createRedisPendingTimesheetChangeStore(redis);
    await store.create(pendingInput('fence_v1'));
    const created = await store.get('fence_v1');
    expect(created?.executionVersion).toBe(0);
    const claimed = await store.claimForExecution('fence_v1');
    expect(claimed?.executionVersion).toBe(1);
    const reclaimed = await staleAndReclaim(redis, store, 'fence_v1');
    expect(reclaimed?.executionVersion).toBe(2);
  });

  it('concurrent reclaim produces exactly one new owner', async () => {
    const redis = createSharedFakeRedis();
    const store = createRedisPendingTimesheetChangeStore(redis);
    await store.create(pendingInput('fence_race'));
    await store.claimForExecution('fence_race');
    const raw = await redis.get<Record<string, unknown>>(
      'timesheet:pending-change:fence_race'
    );
    const staleMs = Date.now() - EXECUTING_LEASE_MS - 1000;
    redis.shared.set(
      'timesheet:pending-change:fence_race',
      JSON.stringify({
        ...raw,
        claimedAt: new Date(staleMs).toISOString(),
        claimedAtMs: staleMs,
      })
    );
    const [a, b] = await Promise.all([
      store.reclaimStaleExecution('fence_race', EXECUTING_LEASE_MS),
      store.reclaimStaleExecution('fence_race', EXECUTING_LEASE_MS),
    ]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.executionVersion).toBe(2);
    const current = await store.get('fence_race');
    expect(current?.executionVersion).toBe(2);
  });

  it('Worker A cannot finalize after Worker B reclaims', async () => {
    const redis = createSharedFakeRedis();
    const store = createRedisPendingTimesheetChangeStore(redis);
    await store.create(pendingInput('fence_stale'));
    const workerA = await store.claimForExecution('fence_stale');
    expect(workerA?.executionVersion).toBe(1);
    const workerB = await staleAndReclaim(redis, store, 'fence_stale');
    expect(workerB?.executionVersion).toBe(2);

    const completedA = await store.markCompleted('fence_stale', 1, {
      resultSnapshotHash: 'evil',
      completedResult: {
        status: 'completed',
        operation: 'create_entry',
        date: '2026-07-18',
        verified: { entries: [], totalHours: 0 },
        message: 'A should not win',
      },
    });
    expect(completedA.ok).toBe(false);
    if (completedA.ok) return;
    expect(completedA.reason).toBe('ownership_lost');
    expect(completedA.change?.executionVersion).toBe(2);
    expect(completedA.change?.status).toBe('executing');

    const failedA = await store.markFailed('fence_stale', 1, 'A fail');
    expect(failedA.ok).toBe(false);
    if (failedA.ok) return;
    expect(failedA.reason).toBe('ownership_lost');

    const conflictA = await store.markConflict('fence_stale', 1);
    expect(conflictA.ok).toBe(false);
    if (conflictA.ok) return;
    expect(conflictA.reason).toBe('ownership_lost');

    const completedB = await store.markCompleted('fence_stale', 2, {
      resultSnapshotHash: 'good',
      completedResult: {
        status: 'completed',
        operation: 'create_entry',
        date: '2026-07-18',
        verified: { entries: [], totalHours: 1 },
        message: 'B wins',
      },
    });
    expect(completedB.ok).toBe(true);

    const overwriteA = await store.markCompleted('fence_stale', 1, {
      resultSnapshotHash: 'overwrite',
      completedResult: {
        status: 'completed',
        operation: 'create_entry',
        date: '2026-07-18',
        verified: { entries: [], totalHours: 99 },
        message: 'overwrite',
      },
    });
    expect(overwriteA.ok).toBe(false);
    const persisted = await store.get('fence_stale');
    expect(persisted?.status).toBe('completed');
    expect(persisted?.resultSnapshotHash).toBe('good');
    expect(persisted?.completedResult?.message).toBe('B wins');
    expect(persisted?.executionVersion).toBe(2);
  });

  it('markCompleted/Failed/Conflict reject pending; failed CAS returns persisted record', async () => {
    const redis = createSharedFakeRedis();
    const store = createRedisPendingTimesheetChangeStore(redis);
    await store.create(pendingInput('fence_pending'));
    const pending = await store.get('fence_pending');
    expect(pending?.status).toBe('pending');

    const completed = await store.markCompleted('fence_pending', 0, {
      resultSnapshotHash: 'x',
    });
    expect(completed).toEqual({
      ok: false,
      reason: 'wrong_status',
      change: expect.objectContaining({ status: 'pending', executionVersion: 0 }),
    });

    const failed = await store.markFailed('fence_pending', 0, 'nope');
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.reason).toBe('wrong_status');
    expect(failed.change?.status).toBe('pending');

    const conflict = await store.markConflict('fence_pending', 0);
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.reason).toBe('wrong_status');
    expect(conflict.change?.status).toBe('pending');
  });

  it('old worker loses ownership before writer — zero Sheets writes', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    let sheets = day(baseEntries);
    const prepared = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 5,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      { pendingStore: store, readDaily: async () => sheets }
    );
    if (prepared.status !== 'confirmation_required') return;

    const fencedStore: typeof store = {
      ...store,
      create: store.create.bind(store),
      get: store.get.bind(store),
      claimForExecution: store.claimForExecution.bind(store),
      reclaimStaleExecution: store.reclaimStaleExecution.bind(store),
      markCompleted: store.markCompleted.bind(store),
      markCancelled: store.markCancelled.bind(store),
      markConflict: store.markConflict.bind(store),
      markFailed: store.markFailed.bind(store),
      findPendingByConversation: store.findPendingByConversation.bind(store),
      assertExecutionOwnership: async () => false,
    };

    const submitDay = vi.fn();
    const result = await confirmTimesheetChange(
      identity,
      prepared.confirmationId,
      {
        pendingStore: fencedStore,
        readDaily: async () => sheets,
        submitDay,
      }
    );
    expect(submitDay).not.toHaveBeenCalled();
    expect(result.status).toBe('already_processing');
  });

  it('reclaimed worker: proposed snapshot completes without write; original writes once; conflict writes zero', async () => {
    const redis = createSharedFakeRedis();
    const store = createRedisPendingTimesheetChangeStore(redis);

    // Proposed already applied — confirm reclaim completes without write
    {
      let sheets = day(baseEntries);
      const prepared = await prepareCreateTimesheetEntry(
        identity,
        {
          date: '2026-07-18',
          hours: 5,
          projectName: 'Hertz',
          taskName: 'Development',
        },
        { pendingStore: store, readDaily: async () => sheets }
      );
      if (prepared.status !== 'confirmation_required') return;
      const pending = await store.get(prepared.confirmationId);
      sheets = day(
        pending!.proposedSnapshot.entries.map((e, i) => ({
          id: `p${i}`,
          projectId: e.projectId,
          taskId: e.taskId,
          hours: e.hours,
        }))
      );
      await store.claimForExecution(prepared.confirmationId);
      await makeLeaseStale(redis, prepared.confirmationId);
      const submitDay = vi.fn();
      const result = await confirmTimesheetChange(
        identity,
        prepared.confirmationId,
        {
          pendingStore: store,
          readDaily: async () => sheets,
          submitDay,
        }
      );
      expect(result.status).toBe('completed');
      expect(submitDay).not.toHaveBeenCalled();
    }

    // Original still present → one write after reclaim
    {
      const redis2 = createSharedFakeRedis();
      const store2 = createRedisPendingTimesheetChangeStore(redis2);
      let sheets = day(baseEntries);
      const prepared = await prepareCreateTimesheetEntry(
        identity,
        {
          date: '2026-07-18',
          hours: 5,
          projectName: 'Hertz',
          taskName: 'Development',
        },
        { pendingStore: store2, readDaily: async () => sheets }
      );
      if (prepared.status !== 'confirmation_required') return;
      await store2.claimForExecution(prepared.confirmationId);
      await makeLeaseStale(redis2, prepared.confirmationId);
      const submitDay = vi.fn(async (_a, _d, entries) => {
        sheets = day(
          entries.map(
            (e: { projectId: string; taskId: string; hours: number }, i: number) => ({
              id: `w${i}`,
              projectId: e.projectId,
              taskId: e.taskId,
              hours: e.hours,
            })
          )
        );
      });
      const result = await confirmTimesheetChange(
        identity,
        prepared.confirmationId,
        {
          pendingStore: store2,
          readDaily: async () => sheets,
          submitDay,
        }
      );
      expect(result.status).toBe('completed');
      expect(submitDay).toHaveBeenCalledTimes(1);
    }

    // Conflicting snapshot → zero writes after reclaim
    {
      const redis3 = createSharedFakeRedis();
      const store3 = createRedisPendingTimesheetChangeStore(redis3);
      const prepared = await prepareCreateTimesheetEntry(
        identity,
        {
          date: '2026-07-18',
          hours: 5,
          projectName: 'Hertz',
          taskName: 'Development',
        },
        { pendingStore: store3, readDaily: async () => day(baseEntries) }
      );
      if (prepared.status !== 'confirmation_required') return;
      await store3.claimForExecution(prepared.confirmationId);
      await makeLeaseStale(redis3, prepared.confirmationId);
      const submitDay = vi.fn();
      const result = await confirmTimesheetChange(
        identity,
        prepared.confirmationId,
        {
          pendingStore: store3,
          readDaily: async () =>
            day([
              {
                id: 'other',
                projectId: 'P-OTHER',
                taskId: 'T-OTHER',
                hours: 9,
              },
            ]),
          submitDay,
        }
      );
      expect(result.status).toBe('conflict');
      expect(submitDay).not.toHaveBeenCalled();
    }
  });

  it('completed retry returns cached completedResult', async () => {
    const store = createInMemoryPendingTimesheetChangeStore();
    let sheets = day(baseEntries);
    const prepared = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 5,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      { pendingStore: store, readDaily: async () => sheets }
    );
    if (prepared.status !== 'confirmation_required') return;
    const submitDay = vi.fn(async (_a, _d, entries) => {
      sheets = day(
        entries.map(
          (e: { projectId: string; taskId: string; hours: number }, i: number) => ({
            id: `w${i}`,
            projectId: e.projectId,
            taskId: e.taskId,
            hours: e.hours,
          })
        )
      );
    });
    const first = await confirmTimesheetChange(identity, prepared.confirmationId, {
      pendingStore: store,
      readDaily: async () => sheets,
      submitDay,
    });
    expect(first.status).toBe('completed');
    const second = await confirmTimesheetChange(identity, prepared.confirmationId, {
      pendingStore: store,
      readDaily: async () => sheets,
      submitDay,
    });
    expect(second).toEqual(first);
    expect(submitDay).toHaveBeenCalledTimes(1);
  });

  it('confirm-vs-cancel: cancel wins → zero writes; confirm wins → cancel not success', async () => {
    const redis = createSharedFakeRedis();
    const store = createRedisPendingTimesheetChangeStore(redis);
    const prepared = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 5,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      { pendingStore: store, readDaily: async () => day(baseEntries) }
    );
    if (prepared.status !== 'confirmation_required') return;

    const cancelled = await cancelTimesheetChange(
      identity,
      prepared.confirmationId,
      { pendingStore: store }
    );
    expect(cancelled.status).toBe('cancelled');
    const submitDay = vi.fn();
    const afterCancel = await confirmTimesheetChange(
      identity,
      prepared.confirmationId,
      {
        pendingStore: store,
        readDaily: async () => day(baseEntries),
        submitDay,
      }
    );
    expect(afterCancel.status).toBe('cancelled');
    expect(submitDay).not.toHaveBeenCalled();

    const prepared2 = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 5,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      { pendingStore: store, readDaily: async () => day(baseEntries) }
    );
    if (prepared2.status !== 'confirmation_required') return;
    await store.claimForExecution(prepared2.confirmationId);
    const cancelAfterClaim = await cancelTimesheetChange(
      identity,
      prepared2.confirmationId,
      { pendingStore: store }
    );
    expect(cancelAfterClaim.status).not.toBe('cancelled');
  });
});

describe('security registry', () => {
  it('direct-write tools absent; allowCustomProject remains false in confirm path', async () => {
    const names = createDefaultToolRegistry()
      .list()
      .map((t) => t.name);
    expect(names).not.toContain('submit_day_timesheet');
    expect(names).not.toContain('clear_day_timesheet');
    expect(names).toContain('confirm_timesheet_change');

    const store = createInMemoryPendingTimesheetChangeStore();
    let sheets = day(baseEntries);
    const submitDay = vi.fn(
      async (
        _a: unknown,
        _d: string,
        entries: Array<{ projectId: string; taskId: string; hours: number }>,
        options?: { allowCustomProject?: boolean }
      ) => {
        expect(options?.allowCustomProject).toBe(false);
        sheets = day(
          entries.map((e, i) => ({
            id: `x${i}`,
            projectId: e.projectId,
            taskId: e.taskId,
            hours: e.hours,
          }))
        );
      }
    );
    const prepared = await prepareCreateTimesheetEntry(
      identity,
      {
        date: '2026-07-18',
        hours: 5,
        projectName: 'Hertz',
        taskName: 'Development',
      },
      { pendingStore: store, readDaily: async () => sheets }
    );
    if (prepared.status !== 'confirmation_required') return;
    await confirmTimesheetChange(identity, prepared.confirmationId, {
      pendingStore: store,
      readDaily: async () => sheets,
      submitDay,
    });
    expect(submitDay).toHaveBeenCalled();
  });
});

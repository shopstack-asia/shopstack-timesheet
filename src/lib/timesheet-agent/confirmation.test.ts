import { describe, expect, it, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();

vi.mock('@/lib/redis', () => ({
  getRedisClient: () => ({
    async get<T>(key: string): Promise<T | null> {
      const v = store.get(key);
      if (!v) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return v as unknown as T;
      }
    },
    async setex(key: string, _seconds: number, value: string) {
      store.set(key, value);
    },
    async setNx(key: string, value: string) {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    },
    async del(key: string) {
      store.delete(key);
    },
  }),
}));

import {
  claimPendingWrite,
  completePendingWrite,
  createPendingWrite,
  getPendingWrite,
  pendingKey,
  wasEventProcessed,
} from '@/lib/timesheet-agent/conversation-state';
import { resolveSlackDedupeId } from '@/lib/slack/dedupe';

function basePending(overrides: Partial<Parameters<typeof createPendingWrite>[0]> = {}) {
  return createPendingWrite({
    employeeId: 'S1',
    slackUserId: 'U1',
    channelId: 'C1',
    threadTs: '123.456',
    operation: 'submit_day_timesheet',
    operationType: 'add',
    targetEntryKey: '1|1',
    targetEntry: { projectId: '1', taskId: '1', hours: 2 },
    baseSnapshot: [],
    payload: { date: '2026-07-14', entries: [{ projectId: '1', taskId: '1', hours: 2 }] },
    warnings: [],
    summaryText: 'sum',
    requireKeyword: 'YES',
    ...overrides,
  });
}

describe('atomic confirmation claim', () => {
  beforeEach(() => {
    store.clear();
  });

  it('concurrent claims: exactly one succeeds', async () => {
    const p = await basePending();
    const results = await Promise.all([
      claimPendingWrite(p.id, 'U1'),
      claimPendingWrite(p.id, 'U1'),
      claimPendingWrite(p.id, 'U1'),
    ]);
    const successes = results.filter((r) => r !== null);
    expect(successes).toHaveLength(1);
    expect(successes[0]?.status).toBe('executing');
  });

  it('wrong user confirmation', async () => {
    const p = await basePending();
    await expect(claimPendingWrite(p.id, 'U2')).rejects.toThrow('WRONG_USER');
  });

  it('expired / completed pending cannot claim', async () => {
    const p = await basePending();
    await completePendingWrite(p.id, 'cancelled');
    const again = await claimPendingWrite(p.id, 'U1');
    expect(again).toBeNull();
    expect(await getPendingWrite(p.id)).toBeNull();
  });

  it('expired by expiresAt cannot claim', async () => {
    const p = await basePending();
    const raw = JSON.parse(store.get(pendingKey(p.id))!) as { expiresAt: number };
    raw.expiresAt = Date.now() - 1000;
    store.set(pendingKey(p.id), JSON.stringify(raw));
    expect(await claimPendingWrite(p.id, 'U1')).toBeNull();
  });

  it('reclaims orphaned executing after claim lock expires', async () => {
    const p = await basePending();
    const first = await claimPendingWrite(p.id, 'U1');
    expect(first?.status).toBe('executing');
    // Simulate claim TTL expiry (crash left status=executing)
    store.delete(`timesheet-agent:pending-claim:${p.id}`);
    const second = await claimPendingWrite(p.id, 'U1');
    expect(second).not.toBeNull();
    expect(second?.status).toBe('executing');
  });

  it('second claim while lock held returns null', async () => {
    const p = await basePending();
    await claimPendingWrite(p.id, 'U1');
    expect(await claimPendingWrite(p.id, 'U1')).toBeNull();
  });

  it('dedupes slack event_id', async () => {
    expect(await wasEventProcessed('Ev123')).toBe(false);
    expect(await wasEventProcessed('Ev123')).toBe(true);
  });

  it('prefers envelope event_id over client_msg_id', () => {
    expect(
      resolveSlackDedupeId(
        { client_msg_id: 'c1', event_ts: '1.2', channel: 'C', ts: '1.2', user: 'U' },
        'EvEnvelope'
      )
    ).toBe('EvEnvelope');
    expect(
      resolveSlackDedupeId({
        client_msg_id: 'c1',
        event_ts: '1.2',
        channel: 'C',
        ts: '1.2',
        user: 'U',
      })
    ).toBe('c1');
  });
});
